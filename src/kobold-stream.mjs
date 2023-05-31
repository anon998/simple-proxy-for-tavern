import { io } from "socket.io-client";

import { StreamTokens } from "./stream.mjs";

const desiredOptions = {
  model: {
    simple_creativity: 0,
    simple_randomness: 0,
    simple_repitition: 0,
    selected_preset: "",
    alt_multi_gen: false,
    numseqs: 1,
    use_alt_rep_pen: false,
  },
  story: {
    actionmode: 0,
    adventure: false,
    authornote: "",
    authornote_length: 0,
    auto_memory: "",
    autosave: false,
    biases: {},
    chat_style: 0,
    chatmode: false,
    commentary_enabled: false,
    dynamicscan: false,
    editln: 0,
    gamesaved: true,
    gamestarted: false,
    gen_audio: false,
    lastact: "",
    lastctx: "",
    memory: "",
    mode: "play",
    notes: "",
    picture: "",
    picture_prompt: "",
    prompt_length: 0,
    storymode: 0,
    submission: "",
    useprompt: false,
  },
  system: {
    alt_gen: false,
    disable_input_formatting: true,
    disable_output_formatting: true,
    full_determinism: false,
    has_genmod: false,
    quiet: false,
  },
  user: {
    formatoptns: {
      frmttriminc: false,
      frmtrmblln: false,
      frmtrmspch: false,
      frmtadsnsp: false,
      singleline: false,
    },
    frmtadsnsp: false,
    frmtrmblln: false,
    frmtrmspch: false,
    frmttriminc: false,
    nogenmod: false,
    nopromptgen: false,
    output_streaming: true,
    remove_double_space: false,
    rngpersist: false,
    singleline: false,
    ui_level: 2,
    wirmvwhtsp: false,
  },
};

const isObject = (value) => {
  const type = typeof value;
  return value != null && (type === "object" || type === "function");
};

const merge = (a, b) => {
  for (const key of Object.keys(b)) {
    if (Array.isArray(a[key]) && Array.isArray(b[key])) {
      a[key] = [...b[key]];
    } else if (isObject(a[key]) && isObject(b[key])) {
      merge(a[key], b[key]);
    } else {
      a[key] = b[key];
    }
  }
  return a;
};

const valuesEqual = (a, b) => {
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
};

const getUI2Cookies = async (url) => {
  const response = await fetch(`${url}/new_ui`);
  return response.headers.raw()?.["set-cookie"]?.[0] ?? "";
};

const resetStory = async (socket) => {
  const waitingReset = new Promise((resolve) => {
    socket.once("reset_story", () => {
      resolve();
    });
  });

  await socket.emitWithAck("update_tokens", "");
  await socket.emitWithAck("new_story", "");

  console.log("waiting for story reset event...");
  await waitingReset;
  console.log("story reset event found!");
};

const createStoryOnConnect = (socket) =>
  new Promise((resolve) => {
    socket.once("connect", async () => {
      console.log("socket connected");
      await resetStory(socket);
      resolve();
    });
  });

const changeKoboldVar = async (socket, id, value) => {
  const response = await socket.emitWithAck("var_change", {
    ID: id,
    value: value,
  });
  console.log({ changeVarResponse: response });
};

const checkOptionsLoaded = (koboldState) => {
  const missing = [];

  for (const classname of Object.keys(desiredOptions)) {
    for (const name of Object.keys(desiredOptions[classname])) {
      if (
        !(classname in koboldState) ||
        !(name in koboldState[classname]) ||
        !valuesEqual(
          desiredOptions[classname][name],
          koboldState[classname][name]
        )
      ) {
        missing.push(`${classname}.${name} still has a different value`);
      }
    }
  }

  if (missing.length) {
    console.log({ pendingOptions: missing });
  }

  return missing.length === 0;
};

const loadOptions = (socket, koboldState) =>
  new Promise((resolve, reject) => {
    socket.on("var_changed", (data) => {
      const { classname, name, value, transmit_time } = data || {};

      merge(koboldState, {
        [classname]: { [name]: value, time: transmit_time },
      });

      if (classname in desiredOptions && name in desiredOptions[classname]) {
        const koboldValue = koboldState[classname][name];
        const desiredValue = desiredOptions[classname][name];

        if (!valuesEqual(koboldValue, desiredValue)) {
          const field = `${classname}_${name}`;
          const desired = JSON.stringify(desiredValue);
          const current = JSON.stringify(koboldValue);
          console.log(`${field} is different ${desired} vs ${current}`);
          changeKoboldVar(socket, field, desiredValue).then(() => {
            console.log(`${field} updated!`);
          });
        }
      }

      if (
        koboldState?.system?.aibusy === false &&
        checkOptionsLoaded(koboldState)
      ) {
        socket.off("var_changed");
        console.log("options loaded!");

        if (koboldState?.system?.noai === true) {
          reject(new Error("No model loaded."));
        } else {
          resolve();
        }
      }
    });
  });

const submitPrompt = (socket) =>
  socket.emitWithAck("submit", { data: "", theme: "" });

const loadPrompt = async (socket, prompt) => {
  await changeKoboldVar(socket, "story_prompt", prompt);
  await socket.emitWithAck("Set Selected Text", { id: 0, text: "" });
};

const waitForGenerationState = (socket, { koboldState, value, checkNow }) =>
  new Promise((resolve) => {
    let onVarChange;

    const doCheck = () => {
      return koboldState?.system?.aibusy === value;
    };

    if (checkNow && doCheck()) {
      return resolve();
    }

    onVarChange = () => {
      if (doCheck()) {
        socket.off("var_changed", onVarChange);
        resolve();
      }
    };

    socket.on("var_changed", onVarChange);
  });

export const koboldGenerateStreamUI2 = async (
  req,
  res,
  genParams,
  config,
  abort
) => {
  let socket;
  let outputText = "";
  const koboldState = {};
  global.koboldState = koboldState;

  const stream = new StreamTokens();
  stream.sendSSEHeaders(req, res, config);

  abort.abortPreviousRequest = () => {
    abort.abortPreviousRequest = null;
    if (socket) {
      socket.emit("abort", "");
    } else {
      stream.abortController?.abort();
    }
  };

  try {
    desiredOptions.model.genamt = genParams.max_length;
    desiredOptions.model.max_length = genParams.max_context_length;
    desiredOptions.model.rep_pen = genParams.rep_pen;
    desiredOptions.model.rep_pen_range = genParams.rep_pen_range;
    desiredOptions.model.rep_pen_slope = genParams.rep_pen_slope;
    desiredOptions.model.sampler_order = genParams.sampler_order;
    desiredOptions.model.temp = genParams.temperature;
    desiredOptions.model.tfs = genParams.tfs;
    desiredOptions.model.top_a = genParams.top_a;
    desiredOptions.model.top_k = genParams.top_k;
    desiredOptions.model.top_p = genParams.top_p;
    desiredOptions.model.typical = genParams.typical;
    desiredOptions.story.stop_sequence = genParams.stop_sequence;
    if (genParams.sampler_seed >= 0) {
      desiredOptions.system.seed_specified = true;
      desiredOptions.system.seed = genParams.sampler_seed;
    } else {
      desiredOptions.system.seed_specified = false;
      delete desiredOptions.seed;
    }

    const cookies = await getUI2Cookies(config.koboldApiUrl);

    const wsUrl = config.koboldApiUrl.replace("http", "ws");
    socket = io.connect(wsUrl, {
      transports: ["websocket"],
      closeOnBeforeunload: false,
      query: { ui: "2" },
      extraHeaders: {
        Cookie: cookies,
      },
    });

    socket.on("error", (error) => {
      console.log("socket error", error);
      stream.emit("error", error);
    });

    socket.on("disconnect", (reason, details) => {
      console.log("socket disconnected", { reason, details });
      stream.emit("error", new Error("Disconnected"));
    });

    console.log("connecting socket and creating new story...");
    await createStoryOnConnect(socket);

    console.log("loading options...");
    await loadOptions(socket, koboldState);

    // update state and stream generated text
    socket.on("var_changed", (data) => {
      const { classname, name, value, transmit_time } = data || {};

      merge(koboldState, {
        [classname]: { [name]: value, time: transmit_time },
      });

      if (classname === "story" && name === "actions") {
        let text = value?.action?.["Selected Text"];
        if (text) {
          text = text.substr(outputText.length);
          outputText += text;
          process.stdout.write(text);
          stream.write({ text, stop: false });
        }
      }
    });

    const streaming = stream.streamTokensToClient(req, res, config);

    const waitingForGenerationStart = waitForGenerationState(socket, {
      koboldState,
      value: true,
      checkNow: false,
    });

    console.log("sending prompt...");
    await loadPrompt(socket, genParams.prompt);
    submitPrompt(socket);

    console.log("waiting for generation to start...");
    await waitingForGenerationStart;

    console.log("waiting for generation to stop...");
    waitForGenerationState(socket, {
      koboldState,
      value: false,
      checkNow: true,
    }).then(() => {
      console.log("generation stopped");
      stream.write({ text: "", stop: true });
    });

    await streaming;
  } catch (error) {
    console.error(error.stack);
  } finally {
    stream.end(req, res);
    socket?.off("disconnect");
    socket?.disconnect();
  }
};
