import http from "http";
import url from "url";
import fs from "fs";

import BodyParser from "body-parser";
import WebSocket from "ws";

import {
  generateText as hordeGenerateText,
  printInfo as hordePrintInfo,
  updateHordeStatus,
} from "./horde.mjs";

let config;
let generationConfig;
let buildLlamaPrompt;
let spp;
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
      `\nERROR: Couldn't load the tokenizer, maybe your Node.js version is too old.`
    );
  }
};

const importConfig = async () => {
  const defaultConfigPath = "./config.default.mjs";
  console.log(`Loading default settings from ${defaultConfigPath}`);
  config = await import(defaultConfigPath).then(
    ({ default: module }) => module
  );

  const userConfigPath = "./config.mjs";
  if (fs.existsSync(userConfigPath)) {
    console.log(`Loading user settings from ${userConfigPath}`);
    const userConfig = await import(userConfigPath).then(
      ({ default: module }) => module
    );
    config = { ...config, ...userConfig };
  }

  console.log(`Loading generation preset from ${config.generationPreset}`);
  const presetPath = `./${config.generationPreset}`;
  generationConfig = JSON.parse(fs.readFileSync(presetPath));

  generationConfig.max_context_length = config.maxContextLength;
  generationConfig.max_length = config.maxNewTokens;
  generationConfig.stopping_strings = config.stoppingStrings;

  console.log(`Loading prompt format from ${config.promptFormat}`);
  const presetFormatPath = `./${config.promptFormat}`;
  buildLlamaPrompt = await import(presetFormatPath).then(
    ({ default: fn }) => fn
  );
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": 1 * 24 * 60 * 60,
};

const toBuffer = (object) => Buffer.from(JSON.stringify(object));

const bodyParseJson = BodyParser.json({
  limit: "100mb",
});

const jsonParse = (req, res) =>
  new Promise((resolve, reject) => {
    bodyParseJson(req, res, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

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
  } else if (config.backendType === "koboldcpp") {
    if ("stopping_strings" in generationConfig) {
      console.log(
        `Swapping 'stopping_strings' for 'stop_sequence' for KoboldCpp.`
      );
      generationConfig["stop_sequence"] = generationConfig["stopping_strings"];
      delete generationConfig["stopping_strings"];
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
    ...corsHeaders,
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

const limitMessagesInContext = (prompt, generationConfig) => {
  const finalPrompt = [];

  const maxSize =
    generationConfig.max_context_length - generationConfig.max_length - 1;

  const fixedSize = prompt
    .filter((v) => !v.prunable)
    .reduce((acum, v) => acum + v.tokenCount, 0);

  let currentSize = fixedSize;
  let tryToFitMore = true;

  for (let i = prompt.length - 1; i >= 0; i--) {
    const currentMessage = prompt[i];
    const prevMessage = finalPrompt[finalPrompt.length - 1];

    if (!currentMessage.prunable) {
      if (
        currentMessage.type === "new-conversation" &&
        prevMessage.type === "new-conversation"
      ) {
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

const findStoppingStringPosition = (stoppingStrings, text) => {
  const positions =
    stoppingStrings && stoppingStrings.length
      ? stoppingStrings.map((v) => text.indexOf(v)).filter((v) => v !== -1)
      : [];

  if (!positions.length) {
    return -1;
  }

  return Math.min(...positions);
};

const truncateGeneratedText = (stoppingStrings, text) => {
  text = text.trimRight();

  let pos = findStoppingStringPosition(stoppingStrings, text);
  if (pos !== -1) {
    console.log("[ TRUNCATED ]:", text.substr(pos));
    text = text.substr(0, pos).trimRight();
  }

  if (config.dropUnfinishedSentences) {
    const endsInLetter = text.match(/[a-zA-Z0-9]$/);
    if (endsInLetter) {
      const punctuation = [...`.?!;)]>"”*`];
      pos = Math.max(...punctuation.map((v) => text.lastIndexOf(v)));
      if (pos > 5) {
        console.log("[ TRUNCATED ]:", text.substr(pos + 1));
        text = text.substr(0, pos + 1);
      }
    }
  }

  return text;
};

const findCharacterNames = (args) => {
  let assistant = "Bot";
  let user = "You";

  let msgIndex = args.messages.findIndex((v) => v.role === "system");
  let msg = args.messages[msgIndex];
  let parts = null;

  if (msg) {
    const newLinePos = msg.content.indexOf("\n");
    const firstLine =
      newLinePos === -1
        ? msg.content.trim()
        : msg.content.substr(0, newLinePos).trim();
    const split = firstLine.split("|");
    if (split.length === 2) {
      parts = split;
    }
  }

  if (!parts) {
    msgIndex = args.messages.length - 1;
    msg = args.messages[msgIndex];

    if (msg.role === "system") {
      if (msg.content === "IMPERSONATION_PROMPT") {
        msgIndex -= 1;
        msg = args.messages[msgIndex];
      }

      const content = msg.content.trim();
      let split = content.split("\n");
      if (split.length === 1) {
        split = content.split("\\n");
      }
      if (split.length === 2) {
        parts = split;
      }
    }
  }

  if (parts) {
    assistant = parts[0].trim();
    user = parts[1].trim();

    const newLinePos = msg.content.indexOf("\n");
    msg.content =
      newLinePos === -1 ? "" : msg.content.substr(newLinePos + 1).trimStart();
    if (msg.content.length === 0) {
      args.messages.splice(msgIndex, 1);
    }
  }

  return { user, assistant };
};

const workAroundTavernDelay = (req, res) => {
  // I don't know why there's this delay in Tavern...
  const tmp = JSON.stringify({
    choices: [{ delta: { content: "" } }],
  });
  for (let i = 0; i < 20; i++) {
    res.write(`data: ${tmp}\n\n`, "utf-8");
  }
};

const formatStoppingStrings = ({ user, assistant }) =>
  config.stoppingStrings.map((v) =>
    v.replaceAll("{{user}}", user).replaceAll("{{char}}", assistant)
  );

const koboldGenerate = async (req, res, genParams, { user, assistant }) => {
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

  const stoppingStrings = formatStoppingStrings({ user, assistant });
  text = truncateGeneratedText(stoppingStrings, text);

  const buffer = toBuffer({
    choices: [{ message: { content: text } }],
  });

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buffer.length,
    ...corsHeaders,
  });

  res.end(buffer, "utf-8");
};

const oobaGenerateStream = (req, res, genParams) =>
  new Promise((resolve) => {
    const ws = new WebSocket(config.oobaStreamUrl);

    ws.onopen = () => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
        "Cache-Control": "no-cache",
        ...corsHeaders,
      });
      res.flushHeaders();
      workAroundTavernDelay(req, res);

      ws.send(JSON.stringify(genParams));
    };

    ws.onerror = (event) => {
      console.error(`WebSocket error: ${event.message}`);
      res.end("data: [DONE]\n\n", "utf-8");
      ws.close();
      resolve();
    };

    ws.onclose = () => {
      resolve();
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log(data);

      if (data.event === "text_stream") {
        const json = JSON.stringify({
          choices: [{ delta: { content: data.text } }],
        });
        res.write(`data: ${json}\n\n`, "utf-8");
      } else if (data.event === "stream_end") {
        res.end("data: [DONE]\n\n", "utf-8");
        ws.close();
      }
    };
  });

const koboldGenerateStream = (req, res, genParams, { user, assistant }) =>
  new Promise(async (resolve) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      ...corsHeaders,
    });
    res.flushHeaders();
    workAroundTavernDelay(req, res);

    const nextChunkLength =
      config.backendType === "koboldcpp" ? 8 : genParams.max_length;

    let lengthToStream = genParams.max_length;
    let generatedSoFar = "";

    const params = { ...genParams, max_length: nextChunkLength };

    const stoppingStrings = formatStoppingStrings({ user, assistant });

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
        console.error(`ERROR: ${text}`);
        res.end("data: [DONE]\n\n", "utf-8");
        return resolve();
      }

      let {
        results: [{ text }],
      } = await resp.json();

      console.log("GENERATED:", text);
      if (config.backendType !== "koboldcpp") {
        text = truncateGeneratedText(stoppingStrings, text);
      } else {
        const pos = findStoppingStringPosition(stoppingStrings, text);
        if (pos !== -1) {
          const currentText = truncateGeneratedText(
            stoppingStrings,
            generatedSoFar + text
          );
          text = currentText.substr(generatedSoFar.length);
          lengthToStream = 0;
        }
      }

      const json = JSON.stringify({
        choices: [{ delta: { content: text } }],
      });
      res.write(`data: ${json}\n\n`, "utf-8");

      lengthToStream -= nextChunkLength;
      params.prompt += text;
      generatedSoFar += text;
    }

    res.end("data: [DONE]\n\n", "utf-8");
    resolve();
  });

const hordeGenerate = async (
  req,
  res,
  genParams,
  { user, assistant, stream }
) => {
  let error;
  let text = '';

  console.log({ stream });
  if (stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      ...corsHeaders,
    });
    res.flushHeaders();
    workAroundTavernDelay(req, res);
  }

  try {
    text = await hordeGenerateText({ hordeState, config, genParams });
    console.log("[ GENERATED ]:", text);

    const stoppingStrings = formatStoppingStrings({ user, assistant });
    text = truncateGeneratedText(stoppingStrings, text);
  } catch (e) {
    error = e;
  }

  if (!stream) {
    if (error) {
      throw error;
    }

    const buffer = toBuffer({
      choices: [{ message: { content: text } }],
    });

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": buffer.length,
      ...corsHeaders,
    });

    res.end(buffer, "utf-8");
  } else {
    if (error) {
      console.error(error.stack);
    }

    const json = JSON.stringify({
      choices: [{ delta: { content: text } }],
    });
    res.write(`data: ${json}\n\n`, "utf-8");
    res.end("data: [DONE]\n\n", "utf-8");
  }
};

const fixExampleMessages = ({ user, assistant, messages }) => {
  let fixedMessages = [];

  for (const { role, content, name } of messages) {
    if (
      role === "system" &&
      (name === "example_assistant" || name === "example_user")
    ) {
      let split;
      if (name === "example_assistant") {
        split = content.split(`\n${assistant}:`);
      } else {
        split = content.split(`\n${user}:`);
      }
      fixedMessages.push({
        role,
        name,
        content: split.map((v) => v.trim()).join("\n"),
      });
    } else {
      fixedMessages.push({ role, content, name });
    }
  }

  return fixedMessages;
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

  const args = req.body;
  console.log("COMPLETIONS", args);

  const { user, assistant } = findCharacterNames(args);
  console.log({ user, assistant });

  const messages = fixExampleMessages({
    user,
    assistant,
    messages: args.messages,
  });

  let prompt = buildLlamaPrompt({
    user,
    assistant,
    messages,
    config,
    generationConfig,
  });

  cleanWhitespaceInMessages(prompt);

  const tokens = tokenize(prompt.map((v) => v.content));
  for (let i = 0; i < prompt.length; i++) {
    prompt[i].tokenCount = tokens[i];
  }

  prompt = limitMessagesInContext(prompt, generationConfig);
  const promptText = cleanWhitespaceInFinalPrompt(
    prompt.map((v) => v.content).join("")
  );
  console.log(`final prompt tokens = ${tokenize([promptText])}`);

  fs.writeFileSync("./prompt.txt", promptText);

  const genParams = {
    ...generationConfig,
    prompt: promptText,
  };
  if ("stopping_strings" in genParams) {
    genParams["stopping_strings"] = formatStoppingStrings({ user, assistant });
    console.log({ stopping_strings: genParams["stopping_strings"] });
  }
  if ("stop_sequence" in genParams) {
    genParams["stop_sequence"] = formatStoppingStrings({ user, assistant });
    console.log({ stop_sequence: genParams["stop_sequence"] });
  }

  if (config.horde.enable) {
    await hordeGenerate(req, res, genParams, {
      user,
      assistant,
      stream: args.stream,
    });
  } else if (args.stream) {
    if (config.backendType === "ooba") {
      await oobaGenerateStream(req, res, genParams, { user, assistant });
    } else {
      await koboldGenerateStream(req, res, genParams, { user, assistant });
    }
  } else {
    await koboldGenerate(req, res, genParams, { user, assistant });
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
    ...corsHeaders,
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
      ...corsHeaders,
    });
    res.end(buffer, "utf-8");
  } catch (ignore) {
    //
  }
};

const httpServer = http.createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  const path = url.parse(req.url, true).pathname;

  try {
    await checkWhichBackend();

    if (req.method === "GET" && path === "/v1/models") {
      await getModels(req, res);
    } else if (req.method === "POST" && path === "/v1/chat/completions") {
      await getChatCompletions(req, res);
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
