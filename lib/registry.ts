import { Provider } from "./types";
import { GenericProvider } from "../providers/generic";
import { AnnasProvider } from "../providers/annas";

const providers: Provider[] = [
  AnnasProvider,
  GenericProvider,
];

export function getProvider(url: string): Provider {
  return providers.find((p) => p.match(url)) || GenericProvider;
}