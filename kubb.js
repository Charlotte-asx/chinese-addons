/*
 * Kubb.tv — 酷播 · v9 (Peticiones Separadas y Estables)
 */

var BASE = String(CONFIG.base || "https://m.kubb.tv").replace(/\/+$/, "");
var API = "https://api.kubb.tv";
var DEVICE_ID = "f361b57d78c7586e378fda1613bd98b7";

function clean(s) {
    return util.htmlDecode(String(s || ""))
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "");
}

// Petición HTTP estándar
function get(url, isJson) {
    var headers = {
        "Accept": isJson ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Origin": BASE,
        "Referer": BASE + "/"
    };
    var h = http.get(url, headers);
    if (!h) throw new Error("无响应 (HTTP " + http.status() + ") 来自 " + url);
    return h;
}

// Petición a la API con parámetros
function api(path, params) {
    var q = [];
    for (var k in params) q.push(k + "=" + encodeURIComponent(params[k]));
    q.push("System=h5", "AppVersion=1.0", "SystemVersion=h5", "version=H3");
    var base = q.join("&") + "&v=1&DeviceId=" + DEVICE_ID + "&i18n=0&pub=" + Math.floor(new Date().getTime() / 1000);
    var url = API + path + "?" + base;
    
    var txt = get(url, true);
    try { 
        return JSON.parse(txt); 
    } catch (e) { 
        throw new Error("JSON inválido de " + path); 
    }
}

// Convierte la lista JSON (del HTML o de la API) a tarjetas para la app
function parseItemsToCards(items) {
    var out = [], seen = {};
    if (!Array.isArray(items)) return out;

    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        // En el HTML se usa 'listPath', en la API se usa 'mediaKey' o 'listPath'
        var key = it.mediaKey || it.listPath;
        if (!key || seen[key]) continue;
        seen[key] = true;
        
        var typeStr = String(it.typeName || it.subTitle || "");
        var isSerie = typeStr.indexOf("剧") >= 0 || typeStr.indexOf("动漫") >= 0 || typeStr.indexOf("综艺") >= 0;

        out.push({
            url: BASE + "/play/" + key,
            image: it.coverImgUrl || it.img || it.image || it.verticalImg || "",
            title: clean(it.title) || "无标题",
            type: isSerie ? "剧集" : "电影",
            kind: isSerie ? "serie" : "movie"
        });
    }
    return out;
}

// ==========================================
// 1. HOME (Listado) - Lee el HTML
// ==========================================
function list(page) {
    page = page || 1;
    var url = BASE + "/list/movie" + (page > 1 ? "?page=" + page : "");
    var html = get(url, false);
    
    // Extraemos el JSON inyectado en el HTML
    var m = /var injectJson = (\{[\s\S]*?\});\s*<\/script>/.exec(html);
    if (!m) return [];

    try {
        var data = JSON.parse(m[1]);
        var outItems = [];
        
        // En el HTML, los videos están en arrays cuya clave contiene "slide-list" o "list"
        for (var key in data) {
            if (Array.isArray(data[key]) && data[key].length > 0 && (data[key][0].listPath || data[key][0].title)) {
                outItems = outItems.concat(data[key]);
            }
        }
        return parseItemsToCards(outItems);
    } catch (e) {
        log("Error parseando home: " + e);
        return [];
    }
}

// ==========================================
// 2. SEARCH (Búsqueda) - Usa la API
// ==========================================
function search(query, page) {
    page = page || 1;
    try {
        // Endpoint exacto de tus capturas
        var json = api("/api/list/getsmallvideo", { 
            videoType: 3, 
            page: page, 
            size: 20, 
            SearchCriteria: query 
        });
        
        // La API devuelve los resultados dentro de json.data
        var items = (json.data && Array.isArray(json.data)) ? json.data : [];
        return parseItemsToCards(items);
    } catch (e) {
        log("Error en búsqueda: " + e);
        return [];
    }
}

// ==========================================
// 3. DETAIL (Detalles) - Usa la API
// ==========================================
function detail(pageUrl) {
    var m = /\/play\/([A-Za-z0-9]+)/.exec(pageUrl);
    if (!m) throw new Error("URL inválida");
    var mediaKey = m[1];

    var json = api("/api/video/videodetails", { mediaKey: mediaKey });
    var info = json.data && json.data.detailInfo;
    if (!info) throw new Error("Sin detalles");

    var isMovie = String(info.typeName || "").indexOf("电影") === 0;
    var d = {
        title: clean(info.title),
        poster: info.coverImgUrl || "",
        synopsis: clean(info.introduce),
        isSeries: !isMovie,
        episodes: []
    };

    var eps = info.episodes || [];
    for (var i = 0; i < eps.length; i++) {
        var ep = eps[i];
        d.episodes.push({
            url: BASE + "/play/" + mediaKey + "?id=" + ep.episodeKey,
            title: isMovie ? "立即播放" : ("第 " + (ep.episodeTitle || (i + 1)) + " 集"),
            season: "1",
            episode: String(i + 1),
            image: d.poster
        });
    }
    if (d.episodes.length === 0) {
        d.episodes.push({ url: pageUrl, title: "立即播放", season: "1", episode: "1", image: d.poster });
    }
    return d;
}

// ==========================================
// 4. SERVERS (Reproductor) - Usa la API
// ==========================================
function servers(episodeUrl) {
    var out = [];
    // Extraemos mediaKey (serie) e id (episodio) de la URL
    var mKeyMatch = /\/play\/([A-Za-z0-9]+)/.exec(episodeUrl);
    var epKeyMatch = /[?&]id=([A-Za-z0-9]+)/.exec(episodeUrl);
    
    if (!mKeyMatch || !epKeyMatch) return out;
    
    var mediaKey = mKeyMatch[1];
    var episodeKey = epKeyMatch[1];

    try {
        var json = api("/api/video/getplaydata", {
            mediaKey: mediaKey,
            videoId: episodeKey,
            videoType: 1,
            liveLine: ""
        });

        var jsonStr = JSON.stringify(json).replace(/\\\//g, "/").replace(/\\u0026/g, "&");
        
        // Buscar el m3u8 en la respuesta
        var re = /https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/g;
        var match, seen = {};
        
        while ((match = re.exec(jsonStr)) !== null) {
            var url = match[0].replace(/&amp;/g, "&");
            if (seen[url]) continue;
            seen[url] = true;
            
            out.push({
                url: url,
                name: "线路 " + (out.length + 1) + " (HLS)",
                referer: BASE + "/"
            });
        }
    } catch (e) {
        log("Error en servidores: " + e);
    }

    return out;
}
