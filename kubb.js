/*
 * Kubb.tv — 酷播 (Películas y Series)
 * v4: Soporte para episodios (?id=) y extracción directa del JSON.
 */

var BASE = String(CONFIG.base || "https://m.kubb.tv").replace(/\/+$/, "");

function clean(s) {
    return util.htmlDecode(String(s || ""))
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "");
}

function abs(u) {
    u = String(u || "");
    if (!u) return "";
    if (/^https?:/i.test(u)) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function getHeaders(referer) {
    return {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": referer || (BASE + "/")
    };
}

function get(url, referer) {
    var h = http.get(url, getHeaders(referer));
    if (!h) throw new Error("无响应 (HTTP " + http.status() + ") 来自 " + url);
    return h;
}

// La web inyecta el estado de Angular en el HTML (usualmente en un script o variable)
function extractJsonData(html) {
    // 1. Intentar la variable injectJson
    var m = /var injectJson = (\{[\s\S]*?\});/.exec(html);
    if (m) {
        try { return JSON.parse(m[1]); } catch (e) {}
    }
    // 2. Intentar el estado inicial de la app (Angular/React)
    m = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/.exec(html);
    if (m) {
        try { return JSON.parse(m[1]); } catch (e) {}
    }
    return null;
}

function parseCardList(data) {
    var out = [];
    if (!data) return out;
    
    // Iterar sobre las claves para encontrar arrays de videos
    for (var key in data) {
        if (Array.isArray(data[key]) && data[key].length > 0 && (data[key][0].url || data[key][0].path) && data[key][0].image) {
            var items = data[key];
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var url = abs(item.url || item.path);
                // Filtrar solo enlaces de reproducción
                if (!url || url.indexOf("/play/") === -1) continue;
                
                // Agregar el ?id= si existe en el item original
                if (item.id && url.indexOf("?id=") === -1) {
                    url += "?id=" + item.id;
                }

                out.push({
                    url: url,
                    image: item.image || item.img || "",
                    title: item.title || "无标题",
                    type: "电影",
                    kind: "movie"
                });
            }
            if (out.length > 0) return out;
        }
    }
    return out;
}

function list(page) {
    page = page || 1;
    var url = BASE + "/list/movie" + (page > 1 ? "?page=" + page : "");
    var html = get(url);
    var data = extractJsonData(html);
    return parseCardList(data);
}

function search(query, page) {
    // La búsqueda se hace vía XHR, pero el HTML inicial de /search a veces trae resultados
    var url = BASE + "/search?keyword=" + encodeURIComponent(query);
    var html = get(url);
    var data = extractJsonData(html);
    return parseCardList(data);
}

function detail(pageUrl) {
    // pageUrl podría ser: https://m.kubb.tv/play/iwE9ZcmnY15?id=MpcyLaQfMyi
    var html = get(pageUrl);
    var d = { isSeries: false, episodes: [] };
    
    var data = extractJsonData(html);
    
    if (data) {
        // Intentar extraer el título
        d.title = data.title || "酷播视频";
        d.poster = data.image || data.img || "";
        d.synopsis = data.description || data.desc || "";

        // Extraer el m3u8 directo
        var jsonStr = JSON.stringify(data);
        var rtmpMatch = /"rtmp":"([^"]+\.m3u8[^"]*)"/.exec(jsonStr);
        var m3u8 = rtmpMatch ? rtmpMatch[1].replace(/\\\//g, "/") : null;

        // Kubb.tv normalmente trata los episodios como listas dentro del JSON.
        // Si el JSON tiene una lista de episodios (ej. data.episodes), la usamos.
        var epList = data.episodes || data.list || data.videoList;
        
        if (epList && Array.isArray(epList) && epList.length > 0) {
            d.isSeries = true;
            for (var i = 0; i < epList.length; i++) {
                var ep = epList[i];
                var epId = ep.id || ep.vid;
                var epUrl = BASE + "/play/" + (ep.pid || pageUrl.split("/").pop()) + (epId ? "?id=" + epId : "");
                
                d.episodes.push({
                    url: epUrl,
                    title: ep.title || ("第 " + (i+1) + " 集"),
                    season: "1",
                    episode: String(i+1),
                    image: ep.image || ep.img || ""
                });
            }
        } else {
            // Es una película o un solo video
            d.episodes.push({
                url: pageUrl,
                title: "立即播放",
                season: "1",
                episode: "1",
                image: d.poster,
                _m3u8: m3u8
            });
        }
    } else {
        // Fallback si no hay JSON
        d.title = "酷播视频";
        d.episodes.push({
            url: pageUrl,
            title: "立即播放",
            season: "1",
            episode: "1",
            image: ""
        });
    }

    return d;
}

function servers(episodeUrl) {
    // episodeUrl será la que generamos en detail() o la original
    var html = get(episodeUrl);
    var data = extractJsonData(html);
    var out = [];

    if (data) {
        var jsonStr = JSON.stringify(data);
        // Buscar el enlace rtmp (m3u8)
        var rtmpMatch = /"rtmp":"([^"]+\.m3u8[^"]*)"/.exec(jsonStr);
        
        if (rtmpMatch) {
            var m3u8 = rtmpMatch[1].replace(/\\\//g, "/");
            out.push({
                url: m3u8,
                name: "线路一 (HLS)",
                referer: episodeUrl
            });
        }
    }
    
    if (out.length === 0) {
        log("酷播: 无法提取 m3u8 链接. 页面数据可能由 JavaScript 异步加载.");
    }
    
    return out;
    }
