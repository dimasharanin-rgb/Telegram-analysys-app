import { startMockAnthropic, type MockProvider } from "./mock-anthropic";

export const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 3199);
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

let provider: MockProvider | null = null;

export default async function globalSetup(): Promise<() => Promise<void>> {
  provider = await startMockAnthropic(MOCK_PORT);
  return async () => {
    await provider?.close();
    provider = null;
  };
}
