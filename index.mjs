import http from "http";
import url from "url";
import fs from 'fs';

import { SentencePieceProcessor } from "sentencepiece-js";
import BodyParser from "body-parser";

const spp = new SentencePieceProcessor();
await spp.load("tokenizer.model");

// conf
const host = "127.0.0.1";
const port = 29172;

const koboldApiUrl = "http://127.0.0.1:5000";

const generationConfig = {
  n: 1,
  max_context_length: 2010 - 210,
  max_length: 200,
  rep_pen: 1.18,
  temperature: 0.7,
  top_p: 1.0,
  top_k: 40,
  top_a: 0.0,
  typical: 1.0,
  tfs: 1.0,
  rep_pen_range: 2048,
  rep_pen_slope: 0.0,
  sampler_order: [0, 1, 2, 3, 4, 5, 6],
  prompt: "",
  quiet: false,
  // stopping_strings: ['\n#'],
  // ban_eos_token: true,
};

const buildLlamaPrompt = ({ user, assistant, messages }) => {
  let systemPrompt = `## ${assistant}
- You're "${assistant}" in this never-ending roleplay with "${user}".`;
  let newConversation = `### New Roleplay:`;
  let context = `### Input:\n`;
  let contextResponse = `### Response:\n(OOC) Understood. I will have this info into account for the roleplay. (end OOC)`;
  //     let replyInstruction = `(OOC) Write only ${assistant} next reply in this roleplay.
  // - Don't take control of ${user}.
  // - **Always** stay in character and be creative, writing with ${assistant}'s style and personality.
  // - Write at least two paragraphs. (end OOC)`;
  let replyInstruction = ``;
  let impersonationInstruction = `Write ${user}'s next reply in this fictional roleplay with ${assistant}.`;
  let userName = (attributes = "") =>
    `### Instruction${attributes}:\n#### ${user}:\n`;
  let assistantName = (attributes = "") =>
    `### Response${attributes}:\n#### ${assistant}:\n`;
  let replyAttributes = ` (2 paragraphs, engaging, natural, authentic, descriptive, creative)`;
  let mainPromptAdded = false;
  let impersonationPromptFound = false;

  let beforeSystem = "\n\n";
  let afterSystem = "\n";
  let beforeUser = "\n\n";
  let afterUser = "\n";
  let beforeAssistant = "\n\n";
  let afterAssistant = "\n";

  let prompt = [];
  if (systemPrompt) {
    prompt.push({
      role: "system",
      type: "system-prompt",
      prunable: false,
      content: `${beforeSystem}${systemPrompt}${afterSystem}`,
    });
  }

  let i = 0;
  for (let { role, content, name } of messages) {
    content = content.trim();
    if (role === "system") {
      if (content === "[Start a new chat]") {
        if (newConversation) {
          prompt.push({
            role: "system",
            type: "new-conversation",
            prunable: false,
            content: `${beforeSystem}${newConversation}${afterSystem}`,
          });
        }
      } else if (!mainPromptAdded) {
        mainPromptAdded = true;
        prompt.push({
          role: "system",
          type: "context",
          prunable: false,
          content: `${beforeSystem}${context}${content}${afterSystem}`,
        });
        if (contextResponse) {
          prompt.push({
            role: "assistant",
            type: "context-response",
            prunable: false,
            content: `${beforeAssistant}${contextResponse}${afterAssistant}`,
          });
        }
      } else if (content === "IMPERSONATION_PROMPT") {
        impersonationPromptFound = true;
      } else if (name === "example_assistant") {
        prompt.push({
          role: "assistant",
          type: "example-conversation",
          prunable: true,
          content: `${beforeAssistant}${assistantName()}${content}${afterAssistant}`,
        });
      } else if (name === "example_user") {
        prompt.push({
          role: "user",
          type: "example-conversation",
          prunable: true,
          content: `${beforeUser}${userName()}${content}${afterUser}`,
        });
      } else {
        prompt.push({
          role: "system",
          type: "other",
          prunable: false,
          content: `${beforeSystem}${content}${afterSystem}`,
        });
      }
    } else if (role === "assistant") {
      if (i === messages.length - 1) {
        if (replyInstruction) {
          prompt.push({
            role: "system",
            type: "reply-instruction",
            prunable: false,
            content: `${beforeSystem}${replyInstruction}${afterSystem}`,
          });
        }
        prompt.push({
          role: "assistant",
          type: "reply",
          prunable: false,
          content: `${beforeAssistant}${assistantName(
            replyAttributes
          )}${content}`,
        });
      } else {
        prompt.push({
          role: "assistant",
          type: "reply",
          prunable: true,
          content: `${beforeAssistant}${assistantName()}${content}${afterAssistant}`,
        });
      }
    } else if (role === "user") {
      prompt.push({
        role: "user",
        type: "reply",
        prunable: true,
        content: `${beforeUser}${userName()}${content}${afterUser}`,
      });
    }
    i++;
  }

  if (messages[messages.length - 1].role !== "assistant") {
    if (impersonationPromptFound) {
      if (impersonationInstruction) {
        prompt.push({
          role: "system",
          type: "impersonation-instruction",
          prunable: false,
          content: `${beforeSystem}${impersonationInstruction}${afterSystem}`,
        });
      }
      prompt.push({
        role: "user",
        type: "reply-to-complete",
        prunable: false,
        content: `${beforeUser}${userName(replyAttributes)}`,
      });
    } else {
      if (replyInstruction) {
        prompt.push({
          role: "system",
          type: "reply-instruction",
          prunable: false,
          content: `${beforeSystem}${replyInstruction}${afterSystem}`,
        });
      }
      prompt.push({
        role: "assistant",
        type: "reply-to-complete",
        prunable: false,
        content: `${beforeAssistant}${assistantName(replyAttributes)}`,
      });
    }
  }

  return prompt;
};

const tokenize = (input) => {
  return input.map((v) => spp.encodeIds(v).length);
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

const getModels = async (req, res) => {
  const resp = await fetch(`${koboldApiUrl}/api/latest/model`);
  const { result: modelName } = await resp.json();

  const result = {
    object: "list",
    data: [
      {
        id: modelName,
        object: "model",
        created: 0,
        owned_by: "kobold",
        permission: [],
        root: modelName,
        parent: null,
      },
    ],
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

const truncateGeneratedText = (text) => {
  let pos = text.indexOf("\n##");
  if (pos !== -1) {
    console.log("TRUNCATED:", text.substr(pos));
    return text.substr(0, pos);
  }
  return text;
};

const findCharacterNames = (args) => {
  let assistant = 'Bot';
  let user = 'You';
  let lastMessageIndex = args.messages.length - 1;
  let lastMessage = args.messages[lastMessageIndex];
  if (lastMessage.role === 'system' && lastMessage.content === 'IMPERSONATION_PROMPT') {
    lastMessageIndex = args.messages.length - 2;
    lastMessage = args.messages[lastMessageIndex];
  }
  if (lastMessage.role === 'system') {
    const lines = lastMessage.content.split('\n');
    if (lines.length === 2) {
      assistant = lines[0].trim();
      user = lines[1].trim();
      args.messages.splice(lastMessageIndex, 1);
    }
  }
  return { user, assistant };
};

const getChatCompletions = async (req, res) => {
  await jsonParse(req, res);

  const args = req.body;
  console.log("COMPLETIONS", args);

  const { user, assistant } = findCharacterNames(args);
  console.log({ user, assistant });

  let prompt = buildLlamaPrompt({
    user,
    assistant,
    messages: args.messages,
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

  const resp = await fetch(`${koboldApiUrl}/api/latest/generate/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...generationConfig,
      prompt: promptText,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(text);
    const buffer = Buffer.from(JSON.stringify(text));
    res.writeHead(501, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": buffer.length,
      ...corsHeaders,
    });
    return res.end(buffer, "utf-8");
  }

  let {
    results: [{ text }],
  } = await resp.json();

  console.log("GENERATED:", text);
  text = truncateGeneratedText(text);

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

const notFound = (req, res) => {
  const buffer = toBuffer({ notfound: true });
  res.writeHead(404, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buffer.length,
    ...corsHeaders,
  });
  res.end(buffer, "utf-8");
};

const httpServer = http.createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  const path = url.parse(req.url, true).pathname;

  try {
    if (req.method === "GET" && path === "/v1/models") {
      await getModels(req, res);
    } else if (req.method === "POST" && path === "/v1/chat/completions") {
      await getChatCompletions(req, res);
    } else {
      await notFound(req, res);
    }
  } catch (error) {
    const buffer = toBuffer({ error: error.message });
    res.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": buffer.length,
      ...corsHeaders,
    });
    res.end(buffer, "utf-8");
  }
});

httpServer.listen(port, host, (error) => {
  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(`listening on http://${host}:${port}`);
});
