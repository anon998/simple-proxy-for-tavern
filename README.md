# Fake OpenAI API for Kobold
This script changes the format of the prompt and it improves the responses when using Tavern.
The LLaMA tokenizer needs a modern Node.js version to work, I use v19 myself.

Clone this repository anywhere in your computer and run this inside the directory:
``` sh
npm install
node index.mjs
```

You can replace the last line to this if you want it to reload automatically when editing the file:
``` sh
npx nodemon index.mjs
```

## Tavern Settings
In Tavern:
+ Select OpenAI API
+ Put "test" or whatever as API key.
+ In presets create a new one called "Alpaca".
+ Set OpenAI Reverse Proxy to http://127.0.0.1:29172/v1
+ Delete Main Prompt, NSFW Prompt, Jailbreak Prompt, Impersonation Prompt.
+ Change Impersonation Prompt to "IMPERSONATION_PROMPT".
+ Change Jailbreak Prompt to "{{char}}\n{{user}}".
+ Leave only NSFW Toggle and Send Jailbreak active, and Streaming if you want that too.

Leave Context Size high so Tavern doesn't truncate the messages, we're doing that in this script.

Tavern settings like Temperature, etc. are ignored, edit generationConfig in the code instead.

If you want to always keep the example messages of the character in the prompt you have to edit keepExampleMessagesInPrompt in index.mjs while also enabling the option in the Tavern UI.

The last prompt is saved as prompt.txt, edit the buildLlamaPrompt function to experiment with the format.

Streaming works for ooba and koboldcpp but it doesn't for kobold.

## Tavern Settings Screenshot
![settings screenshot](./settings.png)
