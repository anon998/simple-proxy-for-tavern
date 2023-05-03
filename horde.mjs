import fetch from "node-fetch";

const hordeUrl = "https://horde.koboldai.net/api";

const agent =
  "simple-proxy-for-tavern:1:https://github.com/anon998/simple-proxy-for-tavern";

const hordeHeaders = {
  ...(agent ? { "Client-Agent": agent } : {}),
};

export const findUser = async (apiKey) => {
  const response = await fetch(`${hordeUrl}/v2/find_user`, {
    method: "GET",
    headers: {
      ...hordeHeaders,
      Accept: "application/json",
      apikey: apiKey,
    },
  });
  const data = await response.json();

  if (response.status === 200) {
    return data;
  } else if (response.status === 400) {
    throw new Error(data.message);
  } else if (response.status === 404) {
    console.log(data);
    return null;
  }
};

export const getStatus = async () => {
  const response = await fetch(`${hordeUrl}/v2/status/heartbeat`, {
    method: "GET",
    headers: {
      ...hordeHeaders,
    },
  });
  return response.ok;
};

export const getNews = async () => {
  const response = await fetch(`${hordeUrl}/v2/status/news`, {
    method: "GET",
    headers: {
      ...hordeHeaders,
      Accept: "application/json",
    },
  });
  return await response.json();
};

export const getModes = async () => {
  const response = await fetch(`${hordeUrl}/v2/status/modes`, {
    method: "GET",
    headers: {
      ...hordeHeaders,
      Accept: "application/json",
    },
  });
  return await response.json();
};

export const getModels = async () => {
  const params = new URLSearchParams({
    type: "text",
  });
  const response = await fetch(`${hordeUrl}/v2/status/models?${params}`, {
    method: "GET",
    headers: {
      ...hordeHeaders,
      Accept: "application/json",
    },
  });
  return await response.json();
};

export const getWorkers = async () => {
  const params = new URLSearchParams({
    type: "text",
  });
  const response = await fetch(`${hordeUrl}/v2/workers?${params}`, {
    method: "GET",
    headers: {
      ...hordeHeaders,
      Accept: "application/json",
    },
  });
  return await response.json();
};

export const getWorkerInfo = async (workerId) => {
  const response = await fetch(`${hordeUrl}/v2/workers/${workerId}`, {
    method: "GET",
    headers: {
      ...hordeHeaders,
      Accept: "application/json",
    },
  });
  const data = await response.json();

  if (response.status === 200) {
    return data;
  } else if ([401, 403].indexOf(response.status) !== -1) {
    throw new Error(data.message);
  } else if (response.status === 404) {
    console.log(data);
    return null;
  }

  console.log(data);
  throw new Error();
};

export const getModelStats = async () => {
  const response = await fetch(`${hordeUrl}/v2/stats/text/models`, {
    method: "GET",
    headers: {
      ...hordeHeaders,
      Accept: "application/json",
    },
  });
  return await response.json();
};

export const getTextStats = async () => {
  const response = await fetch(`${hordeUrl}/v2/stats/text/totals`, {
    method: "GET",
    headers: {
      ...hordeHeaders,
      Accept: "application/json",
    },
  });
  return await response.json();
};

export const requestTextGeneration = async ({ apiKey, payload }) => {
  const response = await fetch(`${hordeUrl}/v2/generate/text/async`, {
    method: "POST",
    headers: {
      ...hordeHeaders,
      apikey: apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if ([200, 202].indexOf(response.status) !== -1) {
    return data;
  } else if ([400, 401, 429, 503].indexOf(response.status) !== -1) {
    throw new Error(data.message);
  }

  console.log(data);
  throw new Error();
};

export const cancelTextGeneration = async (id) => {
  const response = await fetch(`${hordeUrl}/v2/generate/text/status/${id}`, {
    method: "DELETE",
    headers: {
      ...hordeHeaders,
      Accept: "application/json",
    },
  });
  const data = await response.json();

  if (response.status === 200) {
    return data;
  } else if (response.status === 404) {
    return null;
  }

  console.log(data);
  throw new Error();
};

export const getTextGenerationStatus = async (id) => {
  const response = await fetch(`${hordeUrl}/v2/generate/text/status/${id}`, {
    method: "GET",
    headers: {
      ...hordeHeaders,
      Accept: "application/json",
    },
  });
  const data = await response.json();

  if (response.status === 200) {
    return data;
  } else if (response.status === 404) {
    console.log(data);
    return null;
  }

  console.log(data);
  throw new Error();
};

export const getLatestNews = (news) => {
  return news.sort((b, a) =>
    a.date_published.localeCompare(b.date_published)
  )[0];
};

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const updateHordeStatus = async (args) => {
  const delay = 1500;
  const result = {};

  console.log("Fetching Horde info, please wait...");

  if (args.status) {
    result.status = await getStatus();
  }
  if (args.user) {
    result.user = await findUser(args.config.horde.apiKey);
  }
  if (args.news) {
    result.news = await getNews();
    result.latestNews = getLatestNews(result.news);
  }
  if (args.modes) {
    result.modes = await getModes();
  }
  if (args.models) {
    result.models = await getModels();
  }
  if (args.workers) {
    result.workers = await getWorkers();
  }
  if (args.modelStats) {
    result.modelStats = await getModelStats();
  }
  if (args.textStats) {
    result.textStats = getTextStats();
  }

  return result;
};

export const printInfo = (hordeState) => {
  console.log("==== HORDE ====");
  if (hordeState.latestNews) {
    console.log(`NEWS: [${hordeState?.latestNews?.date_published ?? ""} <${
      hordeState?.latestNews?.importance?.toLowerCase() ?? ""
    }>]
"${hordeState?.latestNews?.newspiece}"
`);
  }
  console.log(
    `HORDE STATUS: ${hordeState?.status ? "online" : "offline"}${
      hordeState?.modes?.maintenance_mode ? ", in maintenance" : ""
    }${hordeState?.modes?.invite_only_mode ? ", in invite only mode" : ""}`
  );
  // console.log(
  //   `${hordeState?.textStats?.minute?.tokens ?? 0} tokens and ${
  //     hordeState?.textStats?.minute?.requests ?? 0
  //   } requests in the last minute.`
  // );
  console.log(
    `HORDE USER: ${hordeState?.user?.username ?? ""}, ${
      hordeState?.user?.kudos ?? 0
    } kudos${!hordeState?.user?.pseudonymous ? ", anonymous user" : ""}`
  );
};

export const filterModels = (models, modelsSelected) => {
  return models.filter((currentModel) => {
    if (currentModel.type !== "text") {
      return false;
    }

    return modelsSelected.find((name) =>
      currentModel.name.toLowerCase().startsWith(name.toLowerCase())
    );
  });
};

export const filterWorkers = (workers, { models, onlyTrusted }) => {
  return workers.filter((currentWorker) => {
    if (currentWorker.type !== "text") {
      return false;
    }

    if (
      currentWorker.flagged ||
      currentWorker.maintenance_mode ||
      !currentWorker.online
    ) {
      return false;
    }

    if (onlyTrusted && !currentWorker.trusted) {
      return false;
    }

    return models.find((model) =>
      currentWorker.models.find((name) => name === model.name)
    );
  });
};

export const autoAdjustGenerationParameters = (config, genParams, workers) => {
  let newTokens = config.maxNewTokens;
  let maxContext = config.maxContextLength;

  for (const current of workers) {
    newTokens = Math.min(newTokens, current.max_length);
    maxContext = Math.min(maxContext, current.max_context_length);
  }

  if (config.horde.autoAdjustMaxNewTokens) {
    if (genParams.max_length !== newTokens) {
      console.log(`max new tokens set to ${newTokens}`);
      genParams.max_length = newTokens;
    }
  }

  if (config.horde.autoAdjustMaxContext) {
    if (genParams.max_context_length !== maxContext) {
      console.log(`max context length set to ${maxContext}`);
      genParams.max_context_length = maxContext;
    }
  }
};

export const generateText = async ({ hordeState, config, genParams }) => {
  if (!hordeState.status) {
    throw new Error("Horde is offline.");
  }
  if (hordeState.maintenance_mode) {
    throw new Error("Horde is in maintenance mode.");
  }

  if (hordeState.lastJobId) {
    const cancelId = hordeState.lastJobId;
    console.log(`Cancelling previous job ${cancelId}...`);
    cancelTextGeneration(cancelId)
      .then(() => {
        console.log(`Previous job ${cancelId} cancelled!`);
      })
      .catch((error) => {
        console.error(error.message);
      });
  }

  const models = filterModels(hordeState.models, config.horde.models);

  const prompt = genParams.prompt;
  delete genParams["prompt"];

  const payload = {
    prompt,
    params: genParams,
    trusted_workers: config.horde.onlyTrusted,
    slow_workers: config.horde.slowWorkers,
    models: models.map((v) => v.name),
  };
  if (config.horde.softprompt) {
    payload.softprompt = config.horde.softprompt;
  }
  if (config.horde.workers.length) {
    payload.workers = config.horde.workers;
  }

  const { id } = await requestTextGeneration({
    apiKey: config.horde.apiKey,
    payload,
  });
  hordeState.lastJobId = id;

  const timeStart = new Date().getTime();
  for (;;) {
    const data = await getTextGenerationStatus(id);

    if (!data) {
      throw new Error(`Couldn't get Horde job status.`);
    }

    if (data.done) {
      const generation = data.generations?.[0];
      if (!generation) {
        throw new Error(`Couldn't get generated text.`);
      }
      const timeTaken = (new Date().getTime() - timeStart) / 1000.0;
      console.log(
        `\n{ GENERATED BY ${generation.worker_name} using ${
          generation.model
        } for ${data.kudos} kudos in ${timeTaken.toFixed(2)} seconds. }`
      );
      console.log(
        `Used max_length = ${genParams.max_length} and max_context_length = ${genParams.max_context_length}\n\n`
      );

      hordeState.lastJobId = null;
      return generation.text;
    }

    if (data.faulted) {
      hordeState.lastJobId = null;
      throw new Error("Horde returned faulted=true");
    }

    if (data.processing === 0 && data.waiting === 0) {
      throw new Error("Job cancelled.");
    }

    console.log(
      `wait time = ${data.wait_time}; queue position = ${data.queue_position}; is possible = ${data.is_possible}`
    );
    await wait(3000);
  }
};
