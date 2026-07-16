// ============================================================================
// 家計管理アプリ用 GitHub Gist 中継サーバー（Cloudflare Workers）
// ----------------------------------------------------------------------------
// GitHub Pages（〇〇.github.io）など、ブラウザから api.github.com を直接呼ぶと
// CORS で「Failed to fetch / No 'Access-Control-Allow-Origin' header」エラーになる。
// この Worker が間に入り、CORS ヘッダーを付けて中継することで読込/保存を可能にする。
//
// ■ 使い方（5分）
//   1. https://dash.cloudflare.com にログイン →「Workers & Pages」→「Create」→「Create Worker」
//   2. 適当な名前（例: kakeibo-gh-proxy）で作成 →「Edit code」
//   3. 既定のコードを全部消し、このファイルの中身を丸ごと貼り付けて「Deploy」
//   4. 発行された URL（例: https://kakeibo-gh-proxy.あなた.workers.dev）をコピー
//   5. 家計管理アプリ →「設定」→「中継URL」に貼り付け → 保存
//   これで「クラウドから読込 / クラウドに保存」が使えるようになります。
//
// ■ セキュリティ
//   - GitHub Token はリクエストごとにブラウザから送られ、この Worker はそれを
//     api.github.com へそのまま転送するだけ（保存も記録もしません）。
//   - 下の ALLOWED_ORIGINS を自分のページに絞ると、他人の悪用を防げます。
//     例: const ALLOWED_ORIGINS = ['https://goto11111.github.io'];
//     空配列 [] のままなら全オリジン許可（個人利用なら実用上OK）。
// ============================================================================

const ALLOWED_ORIGINS = []; // 例: ['https://goto11111.github.io']

function corsHeaders(origin) {
  const allow =
    ALLOWED_ORIGINS.length === 0
      ? '*'
      : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    // プリフライト
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // オリジン制限（設定時のみ）
    if (ALLOWED_ORIGINS.length > 0 && origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Forbidden origin', { status: 403, headers: cors });
    }

    // 受け取ったパス（例: /gists/xxxx）をそのまま api.github.com へ転送
    const url = new URL(request.url);
    const target = 'https://api.github.com' + url.pathname + url.search;

    // gist 系のみ許可（この Worker を汎用オープンプロキシにしない）
    if (!url.pathname.startsWith('/gists')) {
      return new Response('Only /gists is allowed', { status: 400, headers: cors });
    }

    const fwdHeaders = new Headers();
    const auth = request.headers.get('Authorization');
    if (auth) fwdHeaders.set('Authorization', auth);
    fwdHeaders.set('Accept', 'application/vnd.github+json');
    fwdHeaders.set('Content-Type', 'application/json');
    // GitHub API は User-Agent 必須
    fwdHeaders.set('User-Agent', 'kakeibo-gist-proxy');

    const init = { method: request.method, headers: fwdHeaders };
    if (request.method === 'POST' || request.method === 'PATCH') {
      init.body = await request.text();
    }

    let ghResp;
    try {
      ghResp = await fetch(target, init);
    } catch (e) {
      return new Response(
        JSON.stringify({ message: 'proxy fetch failed: ' + e.message }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const body = await ghResp.text();
    return new Response(body, {
      status: ghResp.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};
