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
  text
    .replaceAll("{{impersonationPrompt}}", config.impersonationPrompt)
    .replaceAll("{{jailbreak}}", config.jailbreak)
    .replaceAll("{{user}}", config.user)
    .replaceAll("{{char}}", config.assistant);
