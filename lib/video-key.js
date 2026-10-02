// Maps a video page URL to the key its markers are stored under. The content
// script and the manage page both use it, so imported markers land under the
// same key the content script reports for that video.

function youtubeVideoId(url) {
  if (url.pathname === "/watch") return url.searchParams.get("v");
  return url.pathname.match(/^\/live\/([\w-]{11})/)?.[1] || null;
}

// Removes the hash and common volatile playback/session parameters while
// retaining parameters that identify the actual TCC video page.
function stableTccUrl(url) {
  const stable = new URL(url.href);
  stable.hash = "";
  const volatile = /^(token|auth|signature|sig|expires?|timestamp|ts|session|cache|_)/i;
  [...stable.searchParams.keys()].forEach((key) => {
    if (volatile.test(key)) stable.searchParams.delete(key);
  });
  // URLSearchParams order can vary; sorting keeps the marker key stable.
  stable.searchParams.sort();
  return stable.href;
}

function videoKeyFromUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  // The site adapters and host permissions cover HTTPS only.
  if (url.protocol !== "https:") return null;

  if (url.hostname === "www.youtube.com") {
    const id = youtubeVideoId(url);
    return id ? `youtube:${id}` : null;
  }

  if (url.hostname === "live.tcc.gov.tw") {
    const params = url.searchParams;
    const id = params.get("vdvno") || params.get("id") || params.get("videoId") || params.get("VideoId");
    return id ? `tcc:${id}` : `page:${stableTccUrl(url)}`;
  }

  return null;
}
