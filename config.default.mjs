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
  impersonationMaxNewTokens: 100,

  // the AI stops generating when it finds these strings
  // only works for ooba and koboldcpp
  stoppingStrings: ["\n##", "\n{{user}}:"],

  // if you want to pin the example messages in the prompt
  // change it in the Tavern UI too
  keepExampleMessagesInPrompt: false,
  alwaysKeepFirstAssistantExample: true,

  // sentences that are cut in the middle are removed completely
  dropUnfinishedSentences: true,

  // urls used to connect to the kobold/ooba backends
  // the default koboldcpp port is also used
  koboldApiUrl: "http://127.0.0.1:5000",
  oobaStreamUrl: "ws://127.0.0.1:5005/api/v1/stream",
  llamaCppPythonUrl: "http://127.0.0.1:10000",
  llamaCppUrl: "http://127.0.0.1:8080",

  // https://github.com/ggerganov/llama.cpp/tree/master/examples/server#api-endpoints
  llamaCppSettings: {
    n_keep: -1,
    // batch_size: 128,
    // threads: 6,
  },

  // if it should stream by character or not
  streamByCharacter: true,

  // this is detected automatically but it can be forced to a value
  backendType: null, // "kobold", "koboldcpp", "ooba", "llama-cpp-python", "llama.cpp"

  // network interface and port that the proxy uses
  host: "127.0.0.1",
  port: 29172,
  // enable this if you're making requests to the proxy from a web browser
  cors: false,

  // used by the verbose prompt format to make the response more descriptive
  // works well enough to move the response in that general direction
  replyAttributes: ` (2 paragraphs, engaging, natural, authentic, descriptive, creative)`,
  // it's added at the very end of the prompt
  // if the value is "\"", the AI will always start with dialogue in quotes.
  characterBias: "",
  includeCharacterBiasInOutput: true,
  // if empty it will just complete the last AI reply, otherwise it sends this message
  silentMessage: "", // [says nothing]
  // The prompt used for the impersonation function.
  impersonationPrompt:
    "Write {{user}}'s next reply in this fictional roleplay with {{char}}.",

  // set the rng seed
  seed: null,

  // https://github.com/kaiokendev/superbig
  superbig: false,
  superbigApi: "http://127.0.0.1:29180",

  // Horde stuff
  horde: {
    // if it should generate text through the Horde
    enable: false,
    // your api key, the default is anonymous without any priority
    apiKey: "0000000000", // 0000000000
    // they just need to match the start of the name, case insensitive
    // list of available models: https://lite.koboldai.net/
    models: [
      "alpaca-30b",
      "alpacino30b",
      "gpt4-x-alpaca-30b",
      "gpt4-x-alpasta-30b",
      "gpt4-x-alpacadente-30b",
      "llama-30b-supercot",
      // "llama-30b",
      // "llama-65b",
    ],
    // the name of the workers you want to limit the request to
    workers: [], // max 5
    // if enabled, it will set these values to the lowest common value between
    // the available workers
    autoAdjustMaxNewTokens: true,
    autoAdjustMaxContext: true,
    // if you only want to use trusted workers
    onlyTrusted: false,
    // allow slow workers to pick the request
    slowWorkers: true,
    // the softprompt you want to be used
    softprompt: null,
  },
};
