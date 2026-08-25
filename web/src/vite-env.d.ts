/// <reference types="vite/client" />
/// <reference types="google.maps" />

export {};

declare global {
  interface Window {
    initMap?: () => void;
    MAPS_LOADED?: boolean;
  }

  interface Navigator {
    bluetooth?: {
      requestDevice: (options: {
        filters?: { name?: string; namePrefix?: string; services?: string[] }[];
        optionalServices?: string[];
      }) => Promise<any>;
    };
  }
}
