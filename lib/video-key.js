// Maps a video page URL to the key its markers are stored under. The content
// script and the manage page both use it, so imported markers land under the
// same key the content script reports for that video.

function youtubeVideoId(url) {
  if (url.pathname === "/watch") return url.searchParams.get("v");
  return url.pathname.match(/^\/live\/([\w-]{11})/)?.[1] || null;
}

function videoKeyFromUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.hostname === "www.youtube.com") {
    const id = youtubeVideoId(url);
    return id ? `youtube:${id}` : null;
  }

  if (url.hostname === "live.tcc.gov.tw") {
    const params = url.searchParams;
    const id = params.get("vdvno") || params.get("id") || params.get("videoId") || params.get("VideoId");
    return id ? `tcc:${id}` : `page:${url.href}`;
  }

  return null;
}
