export default {
  // settings used to control how the AI generates the response
  // they're in the presets/ directory.
  // https://github.com/KoboldAI/KoboldAI-Client/wiki/Settings-Presets
  generationPreset: "presets/default.json",

  // the format used for the final prompt text
  // they're in the prompt-formats/ directory.
  promptFormat: "prompt-formats/verbose.mjs",

  // max context size/prompt length, lower it if you see OOM errors
  maxContextLength: 2048,

  // amount of tokens to generate
  // higher values makes the available prompt space smaller
  maxNewTokens: 250,

  // the AI stops generating when it finds these strings
  // only works for ooba and koboldcpp
  stoppingStrings: ["\n##", "\n{{user}}:"],

  // if you want to pin the example messages in the prompt
  // change it in the Tavern UI too
  keepExampleMessagesInPrompt: false,

  // sentences that are cut in the middle are removed completely
  dropUnfinishedSentences: true,

  // urls used to connect to the kobold/ooba backends
  // the default koboldcpp port is also used
  koboldApiUrl: "http://127.0.0.1:5000",
  oobaStreamUrl: "ws://127.0.0.1:5005/api/v1/stream",

  // this is detected automatically but it can be forced to a value
  backendType: null, // "kobold", "koboldcpp" or "ooba"

  // network interface and port that the proxy uses
  host: "127.0.0.1",
  port: 29172,

  // used by the verbose prompt format to make the response more descriptive
  // works well enough to move the response in that general direction
  replyAttributes: ` (2 paragraphs, engaging, natural, authentic, descriptive, creative)`,
};
