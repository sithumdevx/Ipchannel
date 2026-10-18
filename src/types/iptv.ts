export interface Channel {
  id: string;
  name: string;
  logo: string;
  category: string;
  url: string;
  country?: string;
  language?: string;
  resolution?: string;
  /**
   * Stream health, as determined by the 5-minute verifier.
   * `true` — probed recently and responding; `false` — confirmed dead (such
   * channels are filtered out of responses entirely); `undefined` — not yet
   * verified for this request cycle.
   */
  isLive?: boolean;
}

export interface ChannelFilterOptions {
  search?: string;
  category?: string;
  country?: string;
  favoritesOnly?: boolean;
}

export interface ChannelsApiResponse {
  channels: Channel[];
  total: number;
  categories: string[];
  countries: string[];
  source: 'live' | 'cache' | 'fallback';
}
