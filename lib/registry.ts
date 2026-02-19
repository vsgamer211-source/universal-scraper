import { Provider } from "./types";
import { GenericProvider } from "../providers/generic";

const providers: Provider[] = [
  GenericProvider,
];

export function getProvider(url: string): Provider {
  return providers.find((p) => p.match(url)) || GenericProvider;
}
