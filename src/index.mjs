import http from "http";
import url from "url";
import fs from "fs";

import {
  koboldGenerate,
  oobaGenerate,
  hordeGenerate,
  abort,
} from "./backends.mjs";

import {
  autoAdjustGenerationParameters,
  filterWorkers,
  filterModels,
  printInfo as hordePrintInfo,
  updateHordeStatus,
} from "./horde.mjs";

import { parseMessages } from "./parse-messages.mjs";

import { toBuffer, jsonParse, formatStoppingStrings } from "./utils.mjs";

let config;
let spp;

let generationConfig;
let buildLlamaPrompt;
let hordeState = {
  status: true,
  user: null,
  news: null,
  latestNews: null,
  modes: null,
  models: null,
  workers: null,
  modelStats: null,
  textStats: null,
  lastJobId: null,
};

const hordeUpdateInterval = 5 * 60 * 1000;

const importFetch = async () => {
  import("node-fetch").then(({ default: fn }) => {
    global.fetch = fn;
  });
};

const importSentencePiece = async () => {
  try {
    const { SentencePieceProcessor } = await import("sentencepiece-js");
    spp = new SentencePieceProcessor();
    await spp.load("tokenizer.model");
    console.log("Tokenizer loaded!");
  } catch (error) {
    spp = null;
    console.error(error.message);
    console.error(
      `\nERROR: Couldn't load the tokenizer, maybe your Node.js version is too old, or you didn't run npm install inside the proxy directory.`
    );
  }
};

const importConfig = async () => {
  const defaultConfigPath = "../config.default.mjs";
  console.log(`Loading default settings from ${defaultConfigPath}`);
  config = await import(defaultConfigPath).then(
    ({ default: module }) => module
  );

  const userConfigPath = "./config.mjs";
  if (fs.existsSync(userConfigPath)) {
    console.log(`Loading user settings from ${userConfigPath}`);
    const userConfig = await import("../" + userConfigPath).then(
      ({ default: module }) => module
    );
    config = { ...config, ...userConfig }; // TODO: merge
  }

  console.log(`Loading generation preset from ${config.generationPreset}`);
  const presetPath = `${config.generationPreset}`;
  generationConfig = JSON.parse(fs.readFileSync(presetPath));

  generationConfig.max_context_length = config.maxContextLength;
  generationConfig.max_length = config.maxNewTokens;
  generationConfig.stopping_strings = config.stoppingStrings;

  console.log(`Loading prompt format from ${config.promptFormat}`);
  const presetFormatPath = `../${config.promptFormat}`;
  buildLlamaPrompt = await import(presetFormatPath).then(
    ({ default: fn }) => fn
  );

  if (config.cors) {
    config.corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": 1 * 24 * 60 * 60,
    };
  } else {
    config.corsHeaders = {};
  }
};

const tokenize = (input) => {
  return input.map((v) => {
    if (spp) {
      return spp.encodeIds(v).length;
    } else {
      return Math.ceil(v.length / 3.35);
    }
  });
};

const getBackendType = async () => {
  let resp;
  let errors = [];

  if (config.horde.enable) {
    return "kobold";
  }

  let koboldCppUrl = config.koboldApiUrl;
  for (let i = 0; i < 2; i++) {
    try {
      resp = await fetch(`${koboldCppUrl}/api/extra/version`);
      if (resp.ok) {
        const json = await resp.json();
        if (json.result === "KoboldCpp") {
          if (config.koboldApiUrl !== koboldCppUrl) {
            config.koboldApiUrl = koboldCppUrl;
            console.log(`Changed Kobold URL to ${config.koboldApiUrl}`);
          }
          return "koboldcpp";
        }
      }
    } catch (error) {
      errors.push(error);
    }

    koboldCppUrl = config.koboldApiUrl.replace(/(.*):\d+$/g, "$1:5001");
  }

  try {
    resp = await fetch(`${config.koboldApiUrl}/api/v1/info/version`);
    if (resp.status === 200) {
      return "kobold";
    } else if (resp.status == 404) {
      return "ooba";
    }
  } catch (error) {
    errors.push(error);
  }

  let message = `Couldn't connect with a Kobold/KoboldCPP/Ooba backend.\n`;
  message += errors.map((v) => v.message).join("\n");
  throw new Error(message);
};

const checkWhichBackend = async () => {
  if (config.backendType === null) {
    config.backendType = await getBackendType();
    console.log({ backendType: config.backendType });
  }

  if (config.backendType === "kobold") {
    if ("stopping_strings" in generationConfig) {
      console.log(
        `Removing 'stopping_strings' since Kobold doesn't support it.`
      );
      delete generationConfig["stopping_strings"];
    }
    // TODO: set seed
  } else if (config.backendType === "koboldcpp") {
    if ("stopping_strings" in generationConfig) {
      console.log(
        `Swapping 'stopping_strings' for 'stop_sequence' for KoboldCpp.`
      );
      generationConfig["stop_sequence"] = generationConfig["stopping_strings"];
      delete generationConfig["stopping_strings"];
    }
    // TODO: set seed
  } else if (config.backendType === "ooba") {
    if (config.seed !== null) {
      generationConfig["seed"] = config.seed;
    }
  }
};

const getModels = async (req, res) => {
  const models = [];

  if (config.horde.enable) {
    models.push("Horde");
  } else {
    const resp = await fetch(`${config.koboldApiUrl}/api/v1/model`);
    const { result: modelName } = await resp.json();
    models.push(modelName);
  }

  const result = {
    object: "list",
    data: models.map((name) => ({
      id: name,
      object: "model",
      created: 0,
      owned_by: "kobold",
      permission: [],
      root: name,
      parent: null,
    })),
  };
  console.log("MODELS", result);
  const buffer = toBuffer(result);

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buffer.length,
    ...config.corsHeaders,
  });

  res.end(buffer, "utf-8");
};

const cleanWhitespaceInMessages = (messages) => {
  for (let i = 0; i < messages.length; i++) {
    messages[i].content = messages[i].content
      .replace(/  +/g, " ")
      .replace(/\n+/g, "\n");
    if (i === 0) {
      messages[i].content = messages[i].content.trimStart();
    }
  }
};

const cleanWhitespaceInFinalPrompt = (text) => {
  return text.replace(/  +/g, " ").replace(/\n+/g, "\n");
};

const limitMessagesInContext = (prompt, genConfig) => {
  const finalPrompt = [];

  const maxSize = genConfig.max_context_length - genConfig.max_length - 1;

  const fixedSize = prompt
    .filter((v) => !v.prunable)
    .reduce((acum, v) => acum + v.tokenCount, 0);

  let currentSize = fixedSize;
  let tryToFitMore = true;

  for (let i = prompt.length - 1; i >= 0; i--) {
    const currentMessage = prompt[i];
    const prevMessage = finalPrompt[finalPrompt.length - 1];

    if (!currentMessage.prunable) {
      const tmp = ["new-example-dialogue", "new-conversation"];
      if (
        (tmp.indexOf(currentMessage.metadata?.type) !== -1 &&
          tmp.indexOf(prevMessage.metadata?.type) !== -1) ||
        (currentMessage.type === "new-conversation" &&
          prevMessage.type === "new-conversation")
      ) {
        // TODO: it doesn't try to fit more messages after changing this
        // TODO: maybe do another loop and add an index to sort the messages
        currentSize -= prompt[i].tokenCount;
      } else {
        finalPrompt.push(prompt[i]);
      }
    } else if (tryToFitMore) {
      if (currentSize + prompt[i].tokenCount <= maxSize) {
        finalPrompt.push(prompt[i]);
        currentSize += prompt[i].tokenCount;
      } else {
        tryToFitMore = false;
      }
    }
  }

  finalPrompt.reverse();

  return finalPrompt;
};

const updateHordeInfo = async () => {
  const result = await updateHordeStatus({
    config,
    user: true,
    modes: true,
    models: true,
    workers: true,
  });
  hordeState = { ...hordeState, ...result };
  hordePrintInfo(hordeState);
};

const getChatCompletions = async (req, res) => {
  await jsonParse(req, res);

  const genParams = { ...generationConfig };

  const args = req.body;
  console.log("COMPLETIONS", args);

  const { updatedMessages: messages, updatedConfig } = parseMessages({
    messages: args.messages,
    config,
  });
  config = { ...config, ...updatedConfig }; // TODO: merge

  let prompt = buildLlamaPrompt({
    user: config.user,
    assistant: config.assistant,
    messages,
    config,
    generationConfig: genParams,
  });

  cleanWhitespaceInMessages(prompt);

  const tokens = tokenize(prompt.map((v) => v.content));
  for (let i = 0; i < prompt.length; i++) {
    prompt[i].tokenCount = tokens[i];
  }

  if (config.horde.enable) {
    const models = filterModels(hordeState.models, config.horde.models);
    const workers = filterWorkers(hordeState.workers, { models });
    autoAdjustGenerationParameters(config, genParams, workers);
  }

  prompt = limitMessagesInContext(prompt, genParams);
  const promptText = cleanWhitespaceInFinalPrompt(
    prompt.map((v) => v.content).join("")
  );
  console.log(`final prompt tokens = ${tokenize([promptText])}`);

  fs.writeFileSync("./prompt.txt", promptText);

  genParams.prompt = promptText;

  if ("stopping_strings" in genParams) {
    genParams["stopping_strings"] = formatStoppingStrings({
      user: config.user,
      assistant: config.assistant,
      stoppingStrings: config.stoppingStrings,
    });
    console.log({ stopping_strings: genParams["stopping_strings"] });
  }
  if ("stop_sequence" in genParams) {
    genParams["stop_sequence"] = formatStoppingStrings({
      user: config.user,
      assistant: config.assistant,
      stoppingStrings: config.stoppingStrings,
    });
    console.log({ stop_sequence: genParams["stop_sequence"] });
  }

  console.log({
    max_length: genParams.max_length,
    max_context_length: genParams.max_context_length,
  });

  const options = {
    ...config,
    user: config.user,
    assistant: config.assistant,
    stream: args.stream,
    hordeState,
  };

  if (config.horde.enable) {
    await hordeGenerate(req, res, genParams, options);
  } else if (config.backendType === "ooba") {
    await oobaGenerate(req, res, genParams, options);
  } else {
    await koboldGenerate(req, res, genParams, options);
  }
};

const notFound = (req, res) => {
  const buffer = toBuffer({
    notfound: true,
    text: "You aren't supposed to open this in a browser.",
  });
  res.writeHead(404, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buffer.length,
    ...config.corsHeaders,
  });
  res.end(buffer, "utf-8");
};

const handleError = (req, res, error) => {
  try {
    console.error(error.stack);
    const buffer = toBuffer({ error: error.message });
    res.writeHead(501, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": buffer.length,
      ...config.corsHeaders,
    });
    res.end(buffer, "utf-8");
  } catch (ignore) {
    //
  }
};

const cancelPreviousRequest = async () => {
  abort.abortPreviousRequest?.();

  if (abort.waitingForPreviousRequest) {
    console.log("Waiting for last request to finish.");
    await abort.waitingForPreviousRequest;
    abort.waitingForPreviousRequest = null;
    console.log("Previous request finished.");
  }
};

const httpServer = http.createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, config.corsHeaders);
    return res.end();
  }

  const path = url.parse(req.url, true).pathname;

  try {
    await checkWhichBackend();

    if (req.method === "GET" && path === "/v1/models") {
      await getModels(req, res);
    } else if (req.method === "POST" && path === "/v1/chat/completions") {
      let previousRequestResolve;

      await cancelPreviousRequest();
      abort.waitingForPreviousRequest = new Promise((resolve) => {
        previousRequestResolve = resolve;
      });

      req.socket.on("close", () => {
        abort.abortPreviousRequest?.();
      });

      try {
        await getChatCompletions(req, res);
      } finally {
        abort.abortPreviousRequest = null;
        previousRequestResolve();
      }
    } else {
      await notFound(req, res);
    }
  } catch (error) {
    handleError(req, res, error);
  }
});

const startServer = () => {
  httpServer.listen(config.port, config.host, async (error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }

    console.log(`Using these Kobold generation settings: `, generationConfig);
    console.log(
      `Proxy OpenAI API URL at http://${config.host}:${config.port}/v1`
    );
    console.log(`Using these URLs to find the backend:`);
    console.log(`- Kobold: ${config.koboldApiUrl} or :5001`);
    console.log(`- Ooba stream: ${config.oobaStreamUrl}\n`);

    if (config.horde.enable) {
      await updateHordeInfo();
      setInterval(updateHordeInfo, hordeUpdateInterval);
    }
  });
};

Promise.all([importSentencePiece(), importConfig(), importFetch()]).then(() => {
  startServer();
});
