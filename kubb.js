/*
 * Kubb.tv — Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * Estrategia: Consumir la API JSON oculta en el HTML y extraer el stream .m3u8 directo.
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

// Cabeceras para simular un navegador
function getHeaders(referer) {
    return {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": referer || (BASE + "/")
    };
}

function get(url, referer) {
    var h = http.get(url, getHeaders(referer));
    if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
    return h.replace(/[\r\n]+/g, "");
}

// La API inyecta un JSON gigante en la variable 'injectJson'
function extractJson(html) {
    var m = /var injectJson = (\{[\s\S]*?\});/.exec(html);
    if (!m) return null;
    try {
        return JSON.parse(m[1]);
    } catch (e) {
        log("Error parseando injectJson: " + e);
        return null;
    }
}

function parseCardList(data) {
    var out = [];
    if (!data) return out;
    
    // La API devuelve un objeto donde las claves son como "slide-list_region..."
    // o listados de películas. Iteramos para encontrar los arrays de items.
    for (var key in data) {
        if (Array.isArray(data[key]) && data[key].length > 0 && data[key][0].url && data[key][0].image) {
            var items = data[key];
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var url = abs(item.url || item.path);
                if (!url || url.indexOf("/play/") === -1) continue;
                
                out.push({
                    url: url,
                    image: item.image || item.img || "",
                    title: item.title || "Sin título",
                    type: item.subTitle && item.subTitle.indexOf("剧") >= 0 ? "Serie" : "Película",
                    kind: "movie" // Kubb.tv no diferencia visualmente hasta abrir el detalle
                });
            }
            // Si encontramos un array principal de items, lo devolvemos
            if (out.length > 0) break; 
        }
    }
    return out;
}

function list(page) {
    page = page || 1;
    // Usamos la página de películas
    var url = BASE + "/list/movie" + (page > 1 ? "?page=" + page : "");
    var html = get(url);
    var data = extractJson(html);
    return parseCardList(data);
}

function search(query, page) {
    // La búsqueda en Kubb es vía API, pero podemos intentar con la ruta web si existe,
    // o usar el buscador general. Kubb suele usar /search?keyword=...
    // (Nota: si falla, habría que investigar el endpoint exacto de búsqueda de la API)
    var url = BASE + "/search?keyword=" + encodeURIComponent(query);
    var html = get(url);
    var data = extractJson(html);
    return parseCardList(data);
}

function detail(pageUrl) {
    var html = get(pageUrl);
    var d = { isSeries: false, episodes: [] };
    
    // La página /play/ de Kubb no inyecta el JSON completo del título en el HTML inicial
    // (a diferencia de /list/movie). Para obtener los detalles, Kubb hace una llamada XHR.
    // Sin embargo, el JSON inicial a veces contiene el "rtmp" (el enlace .m3u8) si es una película directa.
    
    var data = extractJson(html);
    
    if (data) {
        // Intentar extraer info del título del JSON si está presente
        if (data.title) d.title = data.title;
        
        // Buscar el enlace de video en el JSON
        var m3u8 = null;
        // El JSON de Kubb suele tener una propiedad "rtmp" en la raíz o dentro de listas
        var jsonStr = JSON.stringify(data);
        var rtmpMatch = /"rtmp":"([^"]+\.m3u8[^"]*)"/.exec(jsonStr);
        if (rtmpMatch) {
            m3u8 = rtmpMatch[1].replace(/\\\//g, "/");
        }

        d.episodes.push({
            url: pageUrl,
            title: "Reproducir",
            season: "1",
            episode: "1",
            image: "",
            _m3u8: m3u8 // Guardamos el enlace directo para servers()
        });
    } else {
        // Fallback: Si no hay JSON, al menos mostramos la película para intentar reproducirla
        d.title = "Video Kubb";
        d.episodes.push({
            url: pageUrl,
            title: "Reproducir",
            season: "1",
            episode: "1",
            image: ""
        });
    }
    
    // NOTA: Kubb.tv es una SPA y las series manejan los episodios con otra API que no está expuesta 
    // en el HTML inicial. Este script está optimizado para películas y videos únicos.
    return d;
}

function servers(episodeUrl) {
    // Si en detail() ya encontramos el m3u8, lo devolvemos directamente.
    // Pero como la app llama a servers() de nuevo, tenemos que re-extraerlo.
    
    var html = get(episodeUrl);
    var data = extractJson(html);
    var out = [];
    
    if (data) {
        var jsonStr = JSON.stringify(data);
        // Buscar el enlace rtmp (m3u8) en el JSON
        var rtmpMatch = /"rtmp":"([^"]+\.m3u8[^"]*)"/.exec(jsonStr);
        
        if (rtmpMatch) {
            var m3u8 = rtmpMatch[1].replace(/\\\//g, "/");
            out.push({
                url: m3u8,
                name: "Directo (HLS)",
                referer: episodeUrl
            });
        }
    }
    
    if (out.length === 0) {
        log("Kubb: No se encontró enlace m3u8 en el JSON.");
    }
    
    return out;
               }
