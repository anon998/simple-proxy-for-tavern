import BodyParser from "body-parser";

const bodyParseJson = BodyParser.json({
  limit: "100mb",
});

export const toBuffer = (object) => Buffer.from(JSON.stringify(object));

export const jsonParse = (req, res) =>
  new Promise((resolve, reject) => {
    bodyParseJson(req, res, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

export const formatStoppingStrings = ({ user, assistant, stoppingStrings }) =>
  stoppingStrings.map((v) =>
    v.replaceAll("{{user}}", user).replaceAll("{{char}}", assistant)
  );

export const findStoppingStringPosition = (stoppingStrings, text) => {
  const positions =
    stoppingStrings && stoppingStrings.length
      ? stoppingStrings.map((v) => text.indexOf(v)).filter((v) => v !== -1)
      : [];

  if (!positions.length) {
    return -1;
  }

  return Math.min(...positions);
};

export const truncateGeneratedText = (stoppingStrings, text, config) => {
  text = text.trimRight();

  let pos = findStoppingStringPosition(stoppingStrings, text);
  if (pos !== -1) {
    console.log("[ TRUNCATED ]:", text.substring(pos));
    text = text.substring(0, pos).trimRight();
  }

  if (config.dropUnfinishedSentences) {
    const endsInLetter = text.match(/[a-zA-Z0-9]$/);
    if (endsInLetter) {
      const punctuation = [...`.?!;)]>"”*`];
      pos = Math.max(...punctuation.map((v) => text.lastIndexOf(v)));
      if (pos > 5) {
        console.log("[ TRUNCATED ]:", text.substring(pos + 1));
        text = text.substring(0, pos + 1);
      }
    }
  }

  return text;
};

export const replaceTemplates = (text, config) =>
  (text || "")
    .replaceAll("{{impersonationPrompt}}", config.impersonationPrompt)
    .replaceAll("{{jailbreak}}", config.jailbreak)
    .replaceAll("{{user}}", config.user)
    .replaceAll("{{char}}", config.assistant);

export const addStoppingStrings = (config, strings) => {
  for (const current of strings) {
    const found = config.stoppingStrings.find((v) => v === current);
    if (!found) {
      config.stoppingStrings.push(current);
    }
  }
};

export const popLastChatMessages = (prompt, count) => {
  const messages = [];
  let chatMsgCount = 0;

  for (let i = prompt.length - 1; i >= 0 && chatMsgCount < count; i--) {
    const msg = prompt[i];

    if (
      msg.metadata?.type === "user-msg" ||
      msg.metadata?.type === "assistant-msg"
    ) {
      messages.push(msg);
      prompt.splice(i, 1);
      chatMsgCount += 1;
    } else if (msg.metadata?.type === "new-conversation") {
      break;
    } else {
      messages.push(msg);
      prompt.splice(i, 1);
    }
  }

  return messages.reverse();
};

export const popLastAssistantMessage = (prompt) => {
  const index = prompt.findLastIndex(
    (v) => v.metadata?.type === "assistant-msg"
  );
  const msg = prompt[index];
  prompt.splice(index, 1);
  return msg;
};

export const getLastChatMessage = (prompt) =>
  prompt.findLast(
    (msg) =>
      msg.metadata?.type === "user-msg" ||
      msg.metadata?.type === "assistant-msg"
  );

// https://gist.github.com/iwill/a83038623ba4fef6abb9efca87ae9ccb
export const compareVersion = (a, b) => {
  if (a.startsWith(b + "-")) {
    return -1;
  }
  if (b.startsWith(a + "-")) {
    return 1;
  }
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

export const isLlamaCpp = (backend) =>
  ["koboldcpp", "llama.cpp", "llama-cpp-python"].indexOf(backend) !== -1;
