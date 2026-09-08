// services/currentChannel.js — guarda el canal activo en memoria
let _channel = null
function set(ch) { _channel = ch ? ch.toLowerCase() : null }
function get()   { return _channel }
module.exports = { set, get }
