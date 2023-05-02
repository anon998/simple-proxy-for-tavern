# Fake OpenAI API for Kobold

_A workaround to have more control about the prompt format when using SillyTavern and local models._

This script sits between SillyTavern and a backend like Kobold and it lets you change how the final prompt text will look. By default, it includes a prompt format that works well with LLaMA models tuned to follow instructions. It does this by presenting itself to SillyTavern as an OpenAI API, processing the conversation, and sending the prompt text to the backend.

The LLaMA tokenizer needs a modern Node.js version to work. Use the latest **LTS** version of Node.js.

You need a local backend like [KoboldAI](https://github.com/0cc4m/KoboldAI), [koboldcpp](https://github.com/LostRuins/koboldcpp) or [Ooba in API mode](https://github.com/oobabooga/text-generation-webui) to load the model, but it also works with the [Horde](http://koboldai.net/), where people volunteer to share their GPUs online.

## Table of Contents

- [Installation](#installation)
  - [Tavern Settings](#tavern-settings)
  - [Notes](#notes)
- [File Structure](#file-structure)
- [Examples](#examples)
- [Changelog](#changelog)

## Installation

Clone this repository anywhere on your computer and run this inside the directory:

```sh
npm install
node index.mjs
```

You can replace the last line with this if you want it to reload automatically when editing the file:

```sh
npx nodemon index.mjs
```

Copy the file **config.default.mjs** to **config.mjs** if you want to make changes to the config. That way they aren't lost during updates.
If you're going to use the Horde, set your key and the models you want to use there.

There are now generation and prompt formats presets in the _presets/_ and _prompt-formats/_ folders.

### Tavern Settings

After pressing the second button of the top panel, select "OpenAI" as the API and write a random API key; it doesn't matter.
![api connections](./img/api.png)

Press the first button and scroll to the bottom, there's a "Create new preset" button; create one called "Alpaca."

- Scroll up and set "OpenAI Reverse Proxy" to http://127.0.0.1:29172/v1
- Delete Main Prompt, NSFW Prompt, Jailbreak Prompt, Impersonation Prompt.
- Change Impersonation Prompt to "IMPERSONATION_PROMPT".
- Change Jailbreak Prompt to "{{char}}\n{{user}}".
- Leave only NSFW Toggle and Send Jailbreak active, and Streaming if you want that too.

![settings screenshot](./img/settings.png)

Press the second button from the top panel again and select "Connect".

### Notes

Leave Context Size high so Tavern doesn't truncate the messages, we're doing that in this script.

Tavern settings like Temperature, Max Response Length, etc. are ignored, edit _generationPreset_ in conf.mjs to select a preset, the presets are located in the presets/ directory.
There's also a _replyAttributes_ variable that makes the AI give more descriptive responses.

If you want to always keep the example messages of the character in the prompt you have to edit _keepExampleMessagesInPrompt_ in conf.mjs while also enabling the option in the Tavern UI.

The last prompt is saved as prompt.txt. You can use it to check that everything is okay with the way the prompt is generated.

Streaming works for ooba and koboldcpp. Kobold doesn't support streaming or stopping strings.

Ooba needs to be started with --extensions api and the streaming API was added Apr 23, 2023.

## Files

- **config.default.mjs**: default settings
- **config.mjs**: user settings, if exists
- **index.mjs**: proxy code
- **presets/\*.json**: AI generation presets
- **prompt-formats/\*.mjs**: functions to build the prompt
- **tokenizer.model**: LLaMA tokenizer model from huggingface.

## Examples

[Rentry with examples from /lmg/](https://rentry.org/llama-examples)
![rp example](./img/example.jpg)

## Changelog

### 2023-05-02
- Added Horde support, see config.default.mjs.
- Added character bias (a string added at the very end of the prompt)
- Added different configuration variable to set the max amount of tokens to generate while using impersonation.
- Added support to set the character names in Main Prompt in the first line with this format "{{char}}|{{user}}", freeing the jailbreak. The following lines after the first one can be used normally.

### 2023-04-29

- Added a config.mjs file for the settings.
- Added presets/ for generation presets and prompt-formats/ for the functions that generates the prompts.
