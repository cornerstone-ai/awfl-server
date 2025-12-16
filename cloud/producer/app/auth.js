import { GoogleAuth } from 'google-auth-library';
import { WORKFLOWS_AUDIENCE, WORKFLOWS_BASE_URL } from './config.js';

const auth = new GoogleAuth();

export async function getWorkflowsIdTokenHeaders(aud) {
  const audience = aud || WORKFLOWS_AUDIENCE || WORKFLOWS_BASE_URL;
  try {
    const client = await auth.getIdTokenClient(audience);
    const headers = await client.getRequestHeaders(audience);
    return headers; // Authorization Bearer token
  } catch {
    return {};
  }
}
