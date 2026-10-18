export interface Channel {
  id: string;
  name: string;
  logo: string;
  category: string;
  url: string;
  country?: string;
  language?: string;
  resolution?: string;
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
