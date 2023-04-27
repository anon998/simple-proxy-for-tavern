# Fake OpenAI API for Kobold

``` sh
npm install
node index.mjs

# Or this to reload automatically when editing the file:
# npx nodemon index.mjs
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

You can keep "Keep Example Messages in Prompt" on in the UI so the script receives the examples, but you have to change keepExampleMessagesInPrompt in index.mjs to actually change if this script keeps them or not in the prompt. 

The last prompt is saved as prompt.txt, edit the buildLlamaPrompt function to experiment with the format.

## Tavern Settings Screenshot
![settings screenshot](./settings.png)
