import WebSocket from "ws";

import {
  cancelTextGeneration as hordeCancelTextGeneration,
  generateText as hordeGenerateText,
} from "./horde.mjs";

import {
  findStoppingStringPosition,
  formatStoppingStrings,
  toBuffer,
  truncateGeneratedText,
} from "./utils.mjs";

export const abort = {
  abortPreviousRequest: null,
  waitingForPreviousRequest: null,
};

const workAroundTavernDelay = (req, res) => {
  // Tavern takes a while to actually start displaying the characters.
  const tmp = JSON.stringify({
    choices: [{ delta: { content: "" } }],
  });
  for (let i = 0; i < 20; i++) {
    res.write(`data: ${tmp}\n\n`, "utf-8");
  }
};

export const koboldGenerate = async (req, res, genParams, config) => {
  if (config.stream) {
    await koboldGenerateStream(req, res, genParams, config);
  } else {
    await koboldGenerateBlocking(req, res, genParams, config);
  }
};

export const oobaGenerate = async (req, res, genParams, config) => {
  if (config.stream) {
    await oobaGenerateStream(req, res, genParams, config);
  } else {
    await koboldGenerateBlocking(req, res, genParams, config);
  }
};

export const hordeGenerate = async (req, res, genParams, config) => {
  let error;
  let text = "";

  abort.abortPreviousRequest = () => {
    abort.abortPreviousRequest = null;
    const cancelId = config.hordeState.lastJobId;
    if (!cancelId) {
      return;
    }
    hordeCancelTextGeneration(cancelId)
      .then(() => {
        console.log(`Previous job ${cancelId} cancelled!`);
      })
      .catch((error) => {
        console.error(error.message);
      });
  };

  if (config.stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      ...config.corsHeaders,
    });
    res.flushHeaders();
    workAroundTavernDelay(req, res);
  }

  try {
    text = await hordeGenerateText({
      hordeState: config.hordeState,
      config,
      genParams,
    });
    console.log("[ GENERATED ]:", text);

    if (text && config.includeCharacterBiasInOutput) {
      text = `${config.characterBias}${text.trimStart()}`;
    }

    const stoppingStrings = formatStoppingStrings({
      user: config.user,
      assistant: config.assistant,
      stoppingStrings: config.stoppingStrings,
    });
    text = truncateGeneratedText(stoppingStrings, text, config);
  } catch (e) {
    error = e;
  }

  if (!config.stream) {
    if (error) {
      throw error;
    }

    const buffer = toBuffer({
      choices: [{ message: { content: text } }],
    });

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": buffer.length,
      ...config.corsHeaders,
    });

    res.end(buffer, "utf-8");
  } else {
    if (error) {
      console.error(error.stack);
    }

    const json = JSON.stringify({
      choices: [{ delta: { content: text } }],
    });
    res.write(`data: ${json}\n\n`, "utf-8");
    res.end("data: [DONE]\n\n", "utf-8");
  }
};

const koboldGenerateBlocking = async (req, res, genParams, config) => {
  abort.abortPreviousRequest = () => {
    abort.abortPreviousRequest = null;
  };

  const resp = await fetch(`${config.koboldApiUrl}/api/v1/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(genParams),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text);
  }

  let {
    results: [{ text }],
  } = await resp.json();

  console.log("[ GENERATED ]:", text);

  const stoppingStrings = formatStoppingStrings({
    user: config.user,
    assistant: config.assistant,
    stoppingStrings: config.stoppingStrings,
  });
  text = truncateGeneratedText(stoppingStrings, text, config);

  if (text && config.includeCharacterBiasInOutput) {
    text = `${config.characterBias}${
      config.backendType === "koboldcpp" ? text : text.trimStart()
    }`;
  }

  const buffer = toBuffer({
    choices: [{ message: { content: text } }],
  });

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buffer.length,
    ...config.corsHeaders,
  });

  res.end(buffer, "utf-8");
};

const oobaGenerateStream = (req, res, genParams, config) =>
  new Promise((resolve) => {
    const stoppingStrings = formatStoppingStrings({
      user: config.user,
      assistant: config.assistant,
      stoppingStrings: config.stoppingStrings,
    });

    const ws = new WebSocket(config.oobaStreamUrl);

    abort.abortPreviousRequest = () => {
      abort.abortPreviousRequest = null;
      ws.close();
    };

    ws.onopen = () => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
        "Cache-Control": "no-cache",
        ...config.corsHeaders,
      });
      res.flushHeaders();
      workAroundTavernDelay(req, res);

      ws.send(JSON.stringify(genParams));
    };

    ws.onerror = (event) => {
      console.error(`WebSocket error: ${event.message}`);
      res.end("data: [DONE]\n\n", "utf-8");
      ws.close();
      resolve();
    };

    ws.onclose = () => {
      resolve();
    };

    let outputSent = false;
    let textCheckStop = "";

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.event === "text_stream") {
        process.stdout.write(data.text);
        let text = data.text;

        if (!outputSent && text && config.includeCharacterBiasInOutput) {
          text = `${config.characterBias}${text.trimStart()}`;
          outputSent = true;
        }

        textCheckStop += text;
        textCheckStop = textCheckStop.substring(textCheckStop.length - 20);

        // TODO: hold back sending the text if it starts to look like the stopping strings

        const pos = findStoppingStringPosition(stoppingStrings, textCheckStop);
        if (pos !== -1) {
          res.end("data: [DONE]\n\n", "utf-8");
          ws.close();
        } else {
          const json = JSON.stringify({
            choices: [{ delta: { content: text } }],
          });
          res.write(`data: ${json}\n\n`, "utf-8");
        }
      } else if (data.event === "stream_end") {
        console.log(data);
        res.end("data: [DONE]\n\n", "utf-8");
        ws.close();
      }
    };
  });

const koboldGenerateStream = (req, res, genParams, config) =>
  // eslint-disable-next-line no-async-promise-executor
  new Promise(async (resolve) => {
    let lengthToStream = genParams.max_length;
    abort.abortPreviousRequest = () => {
      abort.abortPreviousRequest = null;
      lengthToStream = 0;
    };

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      ...config.corsHeaders,
    });
    res.flushHeaders();
    workAroundTavernDelay(req, res);

    const nextChunkLength =
      config.backendType === "koboldcpp" ? 8 : genParams.max_length;

    let generatedSoFar = "";

    const params = { ...genParams, max_length: nextChunkLength };

    const stoppingStrings = formatStoppingStrings({
      user: config.user,
      assistant: config.assistant,
      stoppingStrings: config.stoppingStrings,
    });

    try {
      while (lengthToStream > 0) {
        const resp = await fetch(`${config.koboldApiUrl}/api/v1/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params),
        });

        if (!resp.ok) {
          const text = await resp.text();
          console.error(`ERROR: ${text}`);
          res.end("data: [DONE]\n\n", "utf-8");
          return resolve();
        }

        let {
          results: [{ text }],
        } = await resp.json();

        console.log("GENERATED:", text);
        if (config.backendType !== "koboldcpp") {
          text = truncateGeneratedText(stoppingStrings, text, config);
        } else {
          const pos = findStoppingStringPosition(stoppingStrings, text);
          if (pos !== -1) {
            const currentText = truncateGeneratedText(
              stoppingStrings,
              generatedSoFar + text,
              config
            );
            text = currentText.substring(generatedSoFar.length);
            lengthToStream = 0;
          }
        }

        if (!generatedSoFar && text && config.includeCharacterBiasInOutput) {
          text = `${config.characterBias}${
            config.backendType === "koboldcpp" ? text : text.trimStart()
          }`;
        }

        const json = JSON.stringify({
          choices: [{ delta: { content: text } }],
        });
        res.write(`data: ${json}\n\n`, "utf-8");

        lengthToStream -= nextChunkLength;
        params.prompt += text;
        generatedSoFar += text;
      }
    } catch (error) {
      console.error(`Error during stream: ${event.message}`);
    } finally {
      res.end("data: [DONE]\n\n", "utf-8");
      resolve();
    }
  });
