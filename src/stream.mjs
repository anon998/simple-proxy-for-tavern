import { on as onEvent, EventEmitter } from "events";
import { setTimeout } from "timers/promises";

import { findStoppingStringPosition, truncateGeneratedText } from "./utils.mjs";

const workAroundTavernDelay = (req, res) => {
  // Tavern takes a while to actually start displaying the characters.
  const tmp = JSON.stringify({
    choices: [{ delta: { content: "" } }],
  });
  for (let i = 0; i < 20; i++) {
    res.write(`data: ${tmp}\n\n`, "utf-8");
  }
};

// Returns true when the string ends with "\nASSOC" and
// the stopping string is "\nASSOCIATE:"
const findPartialStoppingString = (stoppingStrings, text) => {
  const positions = [];

  for (const stop of stoppingStrings) {
    for (let i = stop.length - 1; i >= 0; i--) {
      const currentChar = stop[i];
      if (currentChar === text[text.length - 1]) {
        const currentPartial = stop.substring(0, i + 1);
        if (text.endsWith(currentPartial)) {
          const pos = text.length - i - 1;
          positions.push(pos);
          break;
        }
      }
    }
  }

  let result = -1;
  if (positions.length) {
    result = Math.min(...positions);
  }
  return result;
};

export class StreamTokens extends EventEmitter {
  constructor() {
    super({ captureRejections: true });
    this.timeStart = null;
    this.timeEnd = null;
    this.speed = null;
    this.totalCharCount = 0;
    this.totalReceived = 0;
    this.totalSent = 0;
    this.abortController = new AbortController();
  }

  sendSSEHeaders(req, res, { corsHeaders }) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      ...corsHeaders,
    });
    res.flushHeaders();
    workAroundTavernDelay(req, res);
  }

  end(req, res) {
    console.log("", { event: "stream end" });
    res.end("data: [DONE]\n\n", "utf-8");
  }

  write({ text = "", stop = false }) {
    if (text !== "") {
      const currentTime = new Date().getTime();
      if (this.timeStart === null) {
        this.timeStart = currentTime;
      }
      this.timeEnd = currentTime;
      this.totalReceived += 1;
      this.totalCharCount += text.length;
    }
    this.emit("data", { text, stop });
  }

  updateSpeedPerCharacter() {
    if (this.totalReceived > 1) {
      this.speed = (this.timeEnd - this.timeStart) / this.totalCharCount;
    } else {
      this.speed = 1000 / 60;
    }

    const behind = this.totalReceived - this.totalSent;
    if (behind > 3) {
      this.speed *= 0.5;
    } else if (behind > 1) {
      this.speed *= 0.85;
    }
  }

  async streamTokensToClient(req, res, config) {
    let characterBiasAdded = false;
    let output = "";
    let outputSent = "";

    this.on("error", (error) => {
      console.error(error.stack);
      this.abortController.abort();
    });

    const stoppingStrings = config.formattedStoppingStrings;
    const consecutivePartials = [];

    for await (const event of onEvent(this, "data", {
      signal: this.abortController.signal,
    })) {
      let [{ text, stop }] = event;

      if (!characterBiasAdded && text && config.includeCharacterBiasInOutput) {
        text = `${config.characterBias}${text}`;
        characterBiasAdded = true;
      }

      output += text;

      let textToSend = "";

      const posPartial = config.findPartialStoppingStrings
        ? findPartialStoppingString(stoppingStrings, output)
        : -1;

      if (posPartial !== -1) {
        textToSend = output
          .substring(0, posPartial)
          .trimRight()
          .substring(outputSent.length);
      } else {
        textToSend = output.substring(outputSent.length);
      }

      // this is for koboldcpp
      if (config.findStoppingStrings) {
        let stringToTest = consecutivePartials.join("") + text;
        let pos = findStoppingStringPosition(stoppingStrings, stringToTest);
        if (pos !== -1) {
          const truncatedOutput = truncateGeneratedText(
            stoppingStrings,
            output,
            config
          );
          textToSend = truncatedOutput.substring(outputSent.length);
          stop = true;
        } else if (posPartial === -1) {
          // check if it's still a partial match
          pos = findPartialStoppingString(stoppingStrings, stringToTest);
          if (pos !== -1) {
            consecutivePartials.push(text);
          } else {
            consecutivePartials.length = 0;
          }
        } else {
          consecutivePartials.push(text);
        }
      }

      outputSent += textToSend;

      if (config.streamByCharacter) {
        for (const char of textToSend) {
          const json = JSON.stringify({
            choices: [{ delta: { content: char } }],
          });
          res.write(`data: ${json}\n\n`, "utf-8");

          this.updateSpeedPerCharacter();
          if (this.speed !== null) {
            await setTimeout(this.speed);
          }
        }
      } else {
        const json = JSON.stringify({
          choices: [{ delta: { content: textToSend } }],
        });
        res.write(`data: ${json}\n\n`, "utf-8");
      }

      this.totalSent += 1;

      if (stop) {
        break;
      }
    }

    this.emit("end", {});
  }
}
