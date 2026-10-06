// services/canje-support.js — pestana Top de la pagina de canje: los mas
// ricos (en vivo), el top de donadores y el enlace para apoyar el proyecto.
//
// Solo lectura. Nunca se envian ids internos: cada fila dice `me: true` si es
// el viewer que pregunta. Las reglas estan en support.js.
const { createSupport } = require("./support.js")

const SUPPORT_ROUTES = {
  "/api/top": "GET",
}

// `nameStyleOf`: estilo de nombre equipado de un viewer (tienda de perfil).
function createCanjeSupport({ platform, getChannel, nameStyleOf = () => "" }) {
  const db = platform.db
  const support = createSupport({ platform, getChannel })

  function findViewer(twitchId) {
    return db.prepare("SELECT id FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  function publicRow(viewerId) {
    return ({ viewerId: id, ...row }) => ({ ...row, nameStyle: nameStyleOf(id), me: id === viewerId })
  }

  function top(twitchId) {
    const viewerId = findViewer(twitchId)?.id || null
    const config = support.getConfig()
    return {
      richest: support.richest().map(publicRow(viewerId)),
      donors: support.topDonors().map(publicRow(viewerId)),
      me: viewerId ? support.richRankOf(viewerId) : null,
      support: { tipUrl: config.tipUrl, pointsPerUsd: config.pointsPerUsd },
    }
  }

  return { top }
}

// Atiende una ruta de SUPPORT_ROUTES ya autenticada. Devuelve [status, json].
async function handleSupportApi({ pathname, user, support }) {
  if (pathname === "/api/top") return [200, support.top(user.twitchId)]
  return [404, { error: "No encontrado" }]
}

module.exports = { createCanjeSupport, handleSupportApi, SUPPORT_ROUTES }
