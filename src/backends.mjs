import WebSocket from "ws";

import {
  cancelTextGeneration as hordeCancelTextGeneration,
  generateText as hordeGenerateText,
} from "./horde.mjs";

import { StreamTokens } from "./stream.mjs";
import { koboldGenerateStreamUI2 } from "./kobold-stream.mjs";

import { compareVersion, toBuffer, truncateGeneratedText } from "./utils.mjs";

export const abort = {
  abortPreviousRequest: null,
  waitingForPreviousRequest: null,
};

const parseSSE = (msgBuffer) => {
  const eventList = msgBuffer.split("\n\n");
  const partial = eventList.pop();
  const messages = [];

  for (const event of eventList) {
    for (const part of event.split("\n")) {
      if (!part.startsWith("data: ")) {
        continue;
      }

      try {
        const data = JSON.parse(part.substring("data: ".length));
        messages.push(data);
      } catch (error) {
        console.log(event);
        console.error(error.stack);
      }
    }
  }

  return { msgBuffer: partial, messages };
};

const koboldUpdateGenerationParameters = (genParams, config) => {
  const params = { ...genParams };

  if (
    config.backendType === "koboldcpp" ||
    (config.backendType === "kobold" &&
      !config.horde.enable &&
      (config.stream ||
        compareVersion(config.backendVersion ?? "0.0.0", "1.2.2") >= 0))
  ) {
    if ("stopping_strings" in params) {
      console.log(
        `Swapping 'stopping_strings' for 'stop_sequence' for Kobold.`
      );
      params["stop_sequence"] = params["stopping_strings"];
      delete params["stopping_strings"];
    }
  } else {
    console.log(
      `Removing 'stopping_strings' since this version of Kobold doesn't support it.`
    );
    delete params["stopping_strings"];
  }

  if (config.seed !== null && config.seed >= 0) {
    params.sampler_seed = config.seed;
  }

  return params;
};

export const koboldGenerate = async (req, res, genParams, config) => {
  const params = koboldUpdateGenerationParameters(genParams, config);
  console.log({ koboldParams: { ...params, prompt: "[...]" } });

  if (config.stream && config.backendType === "koboldcpp") {
    if (compareVersion(config.backendVersion ?? "0.0", "1.29") > 0) {
      console.log("KoboldCPP > 1.29, using SSE streaming");
      await koboldCppGenerateStream(req, res, params, config);
    } else {
      console.log("KoboldCPP <= 1.29, using pseudo-streaming");
      await koboldGeneratePseudoStream(req, res, params, config);
    }
  } else if (config.stream) {
    console.log("Using UI2 hack to stream with Kobold");
    await koboldGenerateStreamUI2(req, res, params, config, abort);
  } else {
    await koboldGenerateBlocking(req, res, params, config);
  }
};

export const oobaGenerate = async (req, res, genParams, config) => {
  const params = { ...genParams };
  if (config.seed !== null && config.seed >= 0) {
    params.seed = config.seed;
  }
  console.log({ oobaParams: { ...params, prompt: "[...]" } });

  if (config.stream) {
    await oobaGenerateStream(req, res, params, config);
  } else {
    await koboldGenerateBlocking(req, res, params, config);
  }
};

export const llamaCppPythonGenerate = async (req, res, genParams, config) => {
  const params = {
    prompt: genParams.prompt,
    max_tokens: genParams.max_length,
    temperature: genParams.temperature,
    top_p: genParams.top_p,
    stop: genParams.stopping_strings,
    stream: config.stream,
    frequency_penalty: genParams.tfs,
    top_k: genParams.top_k,
    repeat_penalty: genParams.rep_pen,
  };
  console.log({ llamaCppPythonParams: { ...params, prompt: "[...]" } });

  if (config.stream) {
    await llamaCppPythonGenerateStream(req, res, params, config);
  } else {
    await llamaCppPythonGenerateBlocking(req, res, params, config);
  }
};

export const llamaCppGenerate = async (req, res, genParams, config) => {
  const params = {
    prompt: genParams.prompt,
    n_predict: genParams.max_length,
    stop: genParams.stopping_strings,
    stream: config.stream,
    temperature: genParams.temperature,
    top_p: genParams.top_p,
    top_k: genParams.top_k,
    typical_p: genParams.typical,
    tfs_z: genParams.tfs,
    repeat_penalty: genParams.rep_pen,
    repeat_last_n: genParams.rep_pen_range,
    // these doesn't have an equivalence in kobold:
    presence_penalty: genParams.presence_penalty,
    frequency_penalty: genParams.frequency_penalty,
    mirostat: genParams.mirostat,
    mirostat_tau: genParams.mirostat_tau,
    mirostat_eta: genParams.mirostat_eta,
    seed: config.seed !== null && config.seed >= 0 ? config.seed : undefined,
    ...config.llamaCppSettings,
  };
  console.log({ llamaCppParams: { ...params, prompt: "[...]" } });

  if (config.stream) {
    await llamaCppGenerateStream(req, res, params, config);
  } else {
    await llamaCppGenerateBlocking(req, res, params, config);
  }
};

export const hordeGenerate = async (req, res, genParams, config) => {
  const params = koboldUpdateGenerationParameters(genParams, config);

  let error;
  let text = "";
  let stream;

  abort.abortPreviousRequest = () => {
    abort.abortPreviousRequest = null;
    const cancelId = config.hordeState.lastJobId;
    if (!cancelId) {
      return;
    }
    hordeCancelTextGeneration(cancelId)
      .then(() => {
        console.log(`Previous job ${cancelId} cancelled!`);
      })
      .catch((error) => {
        console.error(error.message);
      });
  };

  if (config.stream) {
    stream = new StreamTokens();
    stream.sendSSEHeaders(req, res, config);
  }

  try {
    text = await hordeGenerateText({
      hordeState: config.hordeState,
      config,
      genParams: params,
    });
    console.log("[ GENERATED ]:", text);

    if (text && config.includeCharacterBiasInOutput) {
      text = `${config.characterBias}${text.trimStart()}`;
    }

    text = truncateGeneratedText(config.formattedStoppingStrings, text, config);
  } catch (e) {
    error = e;
  }

  if (!config.stream) {
    if (error) {
      throw error;
    }

    const buffer = toBuffer({
      choices: [{ message: { content: text } }],
    });

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": buffer.length,
      ...config.corsHeaders,
    });

    res.end(buffer, "utf-8");
  } else {
    const streaming = stream.streamTokensToClient(req, res, {
      ...config,
      streamByCharacter: false,
    });
    if (error) {
      stream.emit("error", error);
    } else {
      stream.write({ text, stop: true });
    }
    await streaming;
    stream.end(req, res);
  }
};

const koboldGenerateBlocking = async (req, res, genParams, config) => {
  abort.abortPreviousRequest = () => {
    abort.abortPreviousRequest = null;
  };

  const resp = await fetch(`${config.koboldApiUrl}/api/v1/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(genParams),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text);
  }

  let {
    results: [{ text }],
  } = await resp.json();

  console.log("[ GENERATED ]:", text);

  text = truncateGeneratedText(config.formattedStoppingStrings, text, config);

  if (text && config.includeCharacterBiasInOutput) {
    text = `${config.characterBias}${
      config.backendType === "koboldcpp" ? text : text.trimStart()
    }`;
  }

  const buffer = toBuffer({
    choices: [{ message: { content: text } }],
  });

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buffer.length,
    ...config.corsHeaders,
  });

  res.end(buffer, "utf-8");
};

const oobaGenerateStream = async (req, res, genParams, config) => {
  let ws;

  abort.abortPreviousRequest = () => {
    abort.abortPreviousRequest = null;
    ws?.close();
  };

  const stream = new StreamTokens();
  stream.sendSSEHeaders(req, res, config);

  const getTokens = (stream) =>
    new Promise((resolve, reject) => {
      stream.on("end", () => {
        ws?.close();
      });

      ws = new WebSocket(config.oobaStreamUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify(genParams));
      };

      ws.onerror = (event) => {
        console.error(`WebSocket error: ${event.message}`);
        reject(new Error(event.message));
        ws.close();
      };

      ws.onclose = () => {
        stream.write({ text: "", stop: true });
        resolve();
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.event === "text_stream") {
          process.stdout.write(data.text);
          stream.write({ text: data.text, stop: false });
        } else if (data.event === "stream_end") {
          stream.write({ text: "", stop: true });
          ws.close();
        }
      };
    });

  try {
    const streaming = stream.streamTokensToClient(req, res, {
      ...config,
      streamByCharacter: false,
      findPartialStoppingStrings: true,
      findStoppingStrings: true,
    });

    getTokens(stream).catch((error) => {
      stream.emit("error", error);
    });

    await streaming;
  } catch (error) {
    console.error(error.stack);
  } finally {
    stream.end(req, res);
  }
};

const koboldGeneratePseudoStream = async (req, res, genParams, config) => {
  let lengthToStream = genParams.max_length;

  abort.abortPreviousRequest = () => {
    abort.abortPreviousRequest = null;
    lengthToStream = 0;
  };

  const stream = new StreamTokens();
  stream.sendSSEHeaders(req, res, config);

  const nextChunkLength = 8;
  const params = { ...genParams, max_length: nextChunkLength };

  const getTokens = async (stream) => {
    stream.on("end", () => {
      lengthToStream = 0;
    });

    while (lengthToStream > 0) {
      const resp = await fetch(`${config.koboldApiUrl}/api/v1/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text);
      }

      let {
        results: [{ text }],
      } = await resp.json();

      stream.write({ text, stop: false });
      process.stdout.write(text);

      lengthToStream -= nextChunkLength;
      params.prompt += text;
    }

    stream.write({ text: "", stop: true });
  };

  try {
    const streaming = stream.streamTokensToClient(req, res, {
      ...config,
      findStoppingStrings: true,
      findPartialStoppingStrings: true,
    });

    getTokens(stream).catch((error) => {
      stream.emit("error", error);
    });

    await streaming;
  } catch (error) {
    console.error(error.stack);
  } finally {
    stream.end(req, res);
  }
};

const koboldCppGenerateStream = async (req, res, genParams, config) => {
  const koboldCppAbortStream = () => {
    fetch(`${config.koboldApiUrl}/api/extra/abort`, { method: "POST" })
      .then((resp) => resp.text())
      .then((text) => console.log(`KoboldCPP abort result: ${text}`))
      .catch((error) => {
        console.error(error.stack);
      });
  };

  abort.abortPreviousRequest = () => {
    abort.abortPreviousRequest = null;
    koboldCppAbortStream();
  };

  const resp = await fetch(`${config.koboldApiUrl}/api/extra/generate/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(genParams),
  });

  if (!resp.ok) {
    throw new Error(await resp.text());
  }

  let body = resp.body;
  const stream = new StreamTokens();
  stream.sendSSEHeaders(req, res, config);

  const getTokens = (stream) =>
    new Promise((resolve, reject) => {
      let msgBuffer = "";
      let messages = [];

      stream.on("end", () => {
        if (body) {
          koboldCppAbortStream();
        }
      });

      body.on("data", (chunk) => {
        ({ msgBuffer, messages } = parseSSE(msgBuffer + chunk.toString()));

        for (const data of messages) {
          const { token: text = "" } = data;
          stream.write({ text, stop: false });
          process.stdout.write(text || "");
        }
      });

      body.on("error", (error) => {
        reject(error);
      });

      body.on("close", () => {
        stream.write({ text: "", stop: true });
        body = null;
        resolve();
      });
    });

  try {
    const streaming = stream.streamTokensToClient(req, res, {
      ...config,
      findStoppingStrings: true,
      findPartialStoppingStrings: true,
    });

    getTokens(stream).catch((error) => {
      stream.emit("error", error);
    });

    await streaming;
  } catch (error) {
    console.error(error.stack);
  } finally {
    stream.end(req, res);
  }
};

const llamaCppPythonGenerateBlocking = async (req, res, genParams, config) => {
  abort.abortPreviousRequest = () => {
    abort.abortPreviousRequest = null;
  };

  const resp = await fetch(`${config.llamaCppPythonUrl}/v1/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(genParams),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text);
  }

  let {
    choices: [{ text }],
  } = await resp.json();

  console.log("[ GENERATED ]:", text);
  text = truncateGeneratedText(config.formattedStoppingStrings, text, config);

  if (text && config.includeCharacterBiasInOutput) {
    text = `${config.characterBias}${text}`;
  }

  const buffer = toBuffer({
    choices: [{ message: { content: text } }],
  });

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buffer.length,
    ...config.corsHeaders,
  });

  res.end(buffer, "utf-8");
};

const llamaCppPythonGenerateStream = async (req, res, genParams, config) => {
  let body;

  abort.abortPreviousRequest = () => {
    abort.abortPreviousRequest = null;
    body?.destroy();
  };

  const resp = await fetch(`${config.llamaCppPythonUrl}/v1/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(genParams),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text);
  }

  body = resp.body;
  if (body.locked) {
    throw new Error("The stream is locked. Please try again");
  }

  const stream = new StreamTokens();
  stream.sendSSEHeaders(req, res, config);

  const getTokens = (stream) =>
    new Promise((resolve, reject) => {
      let msgBuffer = "";
      let messages = [];

      stream.on("end", () => {
        body.destroy();
      });

      body.on("data", (chunk) => {
        const chunkStr = chunk.toString().replaceAll("\r\n", "\n");
        ({ msgBuffer, messages } = parseSSE(msgBuffer + chunkStr));

        for (const data of messages) {
          const text = data?.choices?.[0]?.text ?? "";
          stream.write({ text, stop: false });
          process.stdout.write(text);
        }
      });

      body.on("error", (error) => {
        reject(error);
      });

      body.on("close", () => {
        stream.write({ text: "", stop: true });
        resolve();
      });
    });

  try {
    const streaming = stream.streamTokensToClient(req, res, config);

    getTokens(stream).catch((error) => {
      stream.emit("error", error);
    });

    await streaming;
  } catch (error) {
    console.error(error.stack);
  } finally {
    stream.end(req, res);
  }
};

const llamaCppGenerateBlocking = async (req, res, genParams, config) => {
  abort.abortPreviousRequest = () => {
    abort.abortPreviousRequest = null;
  };

  const resp = await fetch(`${config.llamaCppUrl}/completion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(genParams),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text);
  }

  const json = await resp.json();
  let { content: text } = json;

  console.log("[ GENERATED ]:", text);

  text = truncateGeneratedText(config.formattedStoppingStrings, text, config);

  if (text && config.includeCharacterBiasInOutput) {
    text = `${config.characterBias}${text}`;
  }

  const buffer = toBuffer({
    choices: [{ message: { content: text } }],
  });

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buffer.length,
    ...config.corsHeaders,
  });

  res.end(buffer, "utf-8");
};

const llamaCppGenerateStream = async (req, res, genParams, config) => {
  let body;

  abort.abortPreviousRequest = () => {
    abort.abortPreviousRequest = null;
    body?.destroy();
  };

  const resp = await fetch(`${config.llamaCppUrl}/completion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(genParams),
  });

  if (!resp.ok) {
    throw new Error(await resp.text());
  }

  body = resp.body;
  if (body.locked) {
    throw new Error("The stream is locked. Please try again");
  }

  const stream = new StreamTokens();
  stream.sendSSEHeaders(req, res, config);

  const getTokens = (stream) =>
    new Promise((resolve, reject) => {
      let msgBuffer = "";
      let messages = [];

      stream.on("end", () => {
        body.destroy();
      });

      body.on("data", (chunk) => {
        ({ msgBuffer, messages } = parseSSE(msgBuffer + chunk.toString()));

        for (const data of messages) {
          const { content: text = "", stop = false } = data;
          stream.write({ text, stop });
          process.stdout.write(text || "");
        }
      });

      body.on("error", (error) => {
        reject(error);
      });

      body.on("close", () => {
        stream.write({ text: "", stop: true });
        resolve();
      });
    });

  try {
    const streaming = stream.streamTokensToClient(req, res, config);

    getTokens(stream).catch((error) => {
      stream.emit("error", error);
    });

    await streaming;
  } catch (error) {
    console.error(error.stack);
  } finally {
    stream.end(req, res);
  }
};
