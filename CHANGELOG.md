# Change Log

### 2023-05-21

- Added initial support for [llama.cpp API server](https://github.com/ggerganov/llama.cpp/blob/master/examples/server/README.md). The API isn't very mature yet. There's a _llamaCppSettings_ field in the config for additional parameters.
- Added the option to always keep the first example message for the AI's character.

### 2023-05-14

- Added support for [llama-cpp-python](https://github.com/abetlen/llama-cpp-python).

### 2023-05-10

- Added a default impersonation prompt in the config.
- Fixed character bias when using pseudo-streaming.

### 2023-05-08

- Reorganized the code structure.
- Added option to disable sending the CORS headers.
- Added an option to set the seed for ooba.
- Added [bluemoon](https://huggingface.co/reeducator/bluemoonrp-13b) format.
- Added [vicuna-cocktail](https://huggingface.co/reeducator/vicuna-13b-cocktail) format.
- Added an alternative verbose format.
- Added basic superbig support. There's a new config option and a python script at src/basic-superbig-api.py. It's probably easier to do "pip install superbig" in ooba's env and run the script inside it.
- A custom impersonation prompt can be added on the second line after "IMPERSONATION_PROMPT".

### 2023-05-04

- Added to abort the request when the stop streaming button is pressed.

### 2023-05-03

- Added to cancel the previous request, at least when using koboldcpp and the horde, and wait for the previous request to finish before starting the new one.
- Fixed Horde anonymous requests.
- Added startup scripts.
- Reverted "add support to set the character names in the main prompt." That prompt is not sent when using impersonation. Changed it back to the first line of the Jailbreak.
- Added an option to include the character bias in the final text generated. It's enabled by default.
- Fixed how the singleline prompt format finds who sent the last message and added an option to customize the "[says nothing]" message.

### 2023-05-02

- Added Horde support, see config.default.mjs.
- Added character bias (a string added at the very end of the prompt)
- Added different configuration variable to set the max amount of tokens to generate while using impersonation.
- Added support to set the character names in Main Prompt in the first line with this format "{{char}}|{{user}}", freeing the jailbreak. The following lines after the first one can be used normally.

### 2023-04-29

- Added a config.mjs file for the settings.
- Added presets/ for generation presets and prompt-formats/ for the functions that generates the prompts.
