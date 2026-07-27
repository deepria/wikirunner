const DEFAULT_ALLOWED_HOSTS = ["namu.wiki"] as const;
const DEFAULT_EXCLUDED_NAMESPACES = ["파일", "분류", "file", "category"] as const;
const ARTICLE_PATH_PREFIX = "/w/";

export type NamuWikiUrlErrorCode =
  | "INVALID_URL"
  | "INSECURE_PROTOCOL"
  | "UNSUPPORTED_HOST"
  | "UNSUPPORTED_PORT"
  | "INVALID_PATH"
  | "INVALID_ENCODING"
  | "EMPTY_ARTICLE"
  | "EXCLUDED_NAMESPACE"
  | "INVALID_ARTICLE";

export type NamuWikiUrlResult =
  | {
      ok: true;
      articleKey: string;
      title: string;
      canonicalUrl: string;
    }
  | {
      ok: false;
      code: NamuWikiUrlErrorCode;
    };

export interface NormalizeNamuWikiUrlOptions {
  allowedHosts?: readonly string[];
  excludedNamespaces?: readonly string[];
}

const fail = (code: NamuWikiUrlErrorCode): NamuWikiUrlResult => ({ ok: false, code });

export function normalizeNamuWikiUrl(
  input: string | URL,
  options: NormalizeNamuWikiUrlOptions = {},
): NamuWikiUrlResult {
  let url: URL;

  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    return fail("INVALID_URL");
  }

  if (url.protocol !== "https:") {
    return fail("INSECURE_PROTOCOL");
  }

  if (url.username || url.password || (url.port !== "" && url.port !== "443")) {
    return fail("UNSUPPORTED_PORT");
  }

  const allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  if (!allowedHosts.some((host) => host.toLowerCase() === url.hostname.toLowerCase())) {
    return fail("UNSUPPORTED_HOST");
  }

  if (!url.pathname.startsWith(ARTICLE_PATH_PREFIX)) {
    return fail("INVALID_PATH");
  }

  const encodedArticle = url.pathname.slice(ARTICLE_PATH_PREFIX.length);
  if (!encodedArticle) {
    return fail("EMPTY_ARTICLE");
  }

  let articleKey: string;
  try {
    articleKey = decodeURIComponent(encodedArticle).normalize("NFC");
  } catch {
    return fail("INVALID_ENCODING");
  }

  if (!articleKey) {
    return fail("EMPTY_ARTICLE");
  }

  if ([...articleKey].some(isControlCharacter)) {
    return fail("INVALID_ARTICLE");
  }

  const namespaceSeparator = articleKey.indexOf(":");
  if (namespaceSeparator > 0) {
    const namespace = articleKey.slice(0, namespaceSeparator).trim().toLowerCase();
    const excludedNamespaces = options.excludedNamespaces ?? DEFAULT_EXCLUDED_NAMESPACES;
    if (excludedNamespaces.some((excluded) => excluded.toLowerCase() === namespace)) {
      return fail("EXCLUDED_NAMESPACE");
    }
  }

  return {
    ok: true,
    articleKey,
    title: articleKey,
    canonicalUrl: `https://${url.hostname.toLowerCase()}/w/${encodeURIComponent(articleKey)}`,
  };
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
}

export function articleKeyFromCanonical(
  canonicalUrl: string | null | undefined,
  currentUrl: string,
  options?: NormalizeNamuWikiUrlOptions,
): NamuWikiUrlResult {
  if (canonicalUrl) {
    const canonical = normalizeNamuWikiUrl(canonicalUrl, options);
    if (canonical.ok) {
      return canonical;
    }
  }

  return normalizeNamuWikiUrl(currentUrl, options);
}
