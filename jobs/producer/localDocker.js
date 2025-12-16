import { runLocalDocker } from './docker.js';
import { splitArgs, applyTemplate } from './utils.js';
import { buildLocalConsumerEnv } from './envBuilder.js';

export async function launchLocalPair({
  producerImage,
  producerContainerName,
  producerEnvPairs,
  producerExtraArgs,
  // Consumer (repurposed sidecar) as local Pub/Sub worker
  consumerImage,
  consumerContainerName,
  consumerArgsTemplate,
  workflowsBaseUrl,
  eventsHeartbeatMs,
  reconnectBackoffMs,
  encKeyB64,
  encVer,
  topic,
  subReq,
}) {
  let consumerInfo = null;

  if (consumerImage && consumerContainerName) {
    const renderedArgs = applyTemplate(consumerArgsTemplate || '', {});
    const consumerExtraArgs = [
      '--label', 'awfl.role=sse-consumer-sidecar',
      ...(consumerContainerName ? ['--label', `awfl.container=${consumerContainerName}`] : []),
      ...splitArgs(renderedArgs),
    ];

    const consumerEnv = buildLocalConsumerEnv({
      workflowsBaseUrl,
      eventsHeartbeatMs,
      reconnectBackoffMs,
      encKeyB64,
      encVer,
      topic,
      subReq,
    });

    consumerInfo = await runLocalDocker({
      image: consumerImage,
      containerName: consumerContainerName,
      envPairs: consumerEnv,
      extraArgs: consumerExtraArgs,
    });
  }

  // Producer must run with Pub/Sub env and reply subscription
  const producerInfo = await runLocalDocker({
    image: producerImage || 'awfl-producer:dev',
    containerName: producerContainerName,
    envPairs: producerEnvPairs,
    extraArgs: Array.isArray(producerExtraArgs) ? producerExtraArgs : splitArgs(producerExtraArgs || ''),
  });

  return { producerInfo, consumerInfo };
}
