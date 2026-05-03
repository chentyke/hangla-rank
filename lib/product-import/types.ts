export type ProductImportSiteItem = {
  id?: unknown;
  imageUrl?: unknown;
  sourceUrl?: unknown;
  text?: unknown;
  title?: unknown;
};

export type ProductImportSitePayload = {
  items?: unknown;
};

export type ProductImportCandidate = {
  id: string;
  imageUrl: string;
  remoteImageUrl: string;
  sourceUrl: string;
  text: string;
  title: string;
};

export type ProductImportResponse = {
  items: ProductImportCandidate[];
  sourceUrl: string;
  warnings?: string[];
};
