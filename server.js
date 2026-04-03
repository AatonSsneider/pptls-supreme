const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const cors = require("cors")
const { v4: uuidv4 } = require("uuid")
const fs = require("fs-extra")

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

app.use(cors())
app.use(express.static("public"))

const PORT = process.env.PORT || 3000

let salas = []
let jugadoresOnline = 0

let ranking = {}
let stats = { partidas: 0 }
let achievements = {}

// Limpieza automática cada 30 segundos
const LIMPIEZA_INTERVAL = 30000 // 30 segundos
const SALA_EXPIRACION = 60000 // 60 segundos sin actividad

function loadDB() {
    try {
        ranking = fs.readJsonSync("./database/ranking.json")
        stats = fs.readJsonSync("./database/stats.json")
        achievements = fs.readJsonSync("./database/achievements.json")
    } catch { }
}

function saveDB() {
    fs.writeJsonSync("./database/ranking.json", ranking)
    fs.writeJsonSync("./database/stats.json", stats)
    fs.writeJsonSync("./database/achievements.json", achievements)
}

loadDB()

function limpiarSalasHuérfanas() {
    const ahora = Date.now()
    let eliminadas = 0
    
    salas = salas.filter(sala => {
        // Verificar si la sala tiene jugadores activos
        const jugadoresActivos = sala.jugadores.filter(j => j.ws && j.ws.readyState === WebSocket.OPEN)
        
        // Si no hay jugadores activos, eliminar sala
        if (jugadoresActivos.length === 0) {
            eliminadas++
            return false
        }
        
        // Actualizar lista de jugadores solo con los activos
        sala.jugadores = jugadoresActivos
        
        // Verificar expiración por inactividad
        if (sala.ultimaActividad && (ahora - sala.ultimaActividad > SALA_EXPIRACION)) {
            // Notificar a los jugadores que la sala expiró
            sala.jugadores.forEach(j => {
                if (j.ws && j.ws.readyState === WebSocket.OPEN) {
                    j.ws.send(JSON.stringify({
                        tipo: "error",
                        mensaje: "La partida expiró por inactividad. Busca una nueva partida."
                    }))
                }
            })
            eliminadas++
            return false
        }
        
        return true
    })
    
    if (eliminadas > 0) {
        console.log(`🧹 Limpieza automática: ${eliminadas} sala(s) eliminada(s). Salas activas: ${salas.length}`)
    }
}

// Ejecutar limpieza periódica
setInterval(limpiarSalasHuérfanas, LIMPIEZA_INTERVAL)

function crearSala() {
    const sala = {
        id: uuidv4(),
        jugadores: [],
        movimientos: {},
        ultimaActividad: Date.now(),
        creada: Date.now()
    }
    salas.push(sala)
    console.log(`🏠 Nueva sala creada: ${sala.id}. Total salas: ${salas.length}`)
    return sala
}

function buscarSala() {
    // Primero limpiar salas huérfanas antes de buscar
    limpiarSalasHuérfanas()
    
    // Buscar sala con un solo jugador (pendiente)
    for (let s of salas) {
        const jugadoresActivos = s.jugadores.filter(j => j.ws && j.ws.readyState === WebSocket.OPEN)
        if (jugadoresActivos.length === 1) {
            s.jugadores = jugadoresActivos // Actualizar con solo activos
            console.log(`✅ Sala encontrada: ${s.id} con 1 jugador`)
            return s
        }
    }
    
    // No hay salas disponibles, crear una nueva
    console.log(`🆕 No hay salas disponibles, creando nueva...`)
    return crearSala()
}

function calcularGanador(a, b) {
    const reglas = {
        piedra: ["tijera", "lagarto"],
        papel: ["piedra", "spock"],
        tijera: ["papel", "lagarto"],
        lagarto: ["spock", "papel"],
        spock: ["tijera", "piedra"]
    }
    if (a === b) return 0
    if (reglas[a].includes(b)) return 1
    return 2
}

function movimientoIA() {
    const opciones = ["piedra", "papel", "tijera", "lagarto", "spock"]
    return opciones[Math.floor(Math.random() * 5)]
}

function actualizarActividad(sala) {
    if (sala) {
        sala.ultimaActividad = Date.now()
    }
}

wss.on("connection", ws => {

    jugadoresOnline++
    console.log(`🔌 Nueva conexión. Jugadores online: ${jugadoresOnline}`)

    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })

    ws.send(JSON.stringify({
        tipo: "online",
        jugadores: jugadoresOnline
    }))

    ws.on("message", msg => {
        try {
            const data = JSON.parse(msg)

            if (data.tipo === "buscar") {
                const sala = buscarSala()

                // Verificar que el jugador no esté ya en alguna sala
                if (ws.sala) {
                    // Si ya está en una sala, sacarlo primero
                    const salaAnterior = ws.sala
                    const index = salaAnterior.jugadores.findIndex(j => j.ws === ws)
                    if (index !== -1) {
                        salaAnterior.jugadores.splice(index, 1)
                    }
                }

                const jugador = {
                    ws,
                    nombre: data.nombre || "Anónimo",
                    id: sala.jugadores.length,
                    conectado: true
                }

                sala.jugadores.push(jugador)

                ws.sala = sala
                ws.idJugador = jugador.id
                ws.nombreJugador = jugador.nombre

                ws.send(JSON.stringify({
                    tipo: "asignado",
                    jugador: jugador.id
                }))

                console.log(`👤 Jugador "${jugador.nombre}" (ID: ${jugador.id}) se unió a sala ${sala.id}`)

                // Si la sala tiene 2 jugadores, iniciar partida
                if (sala.jugadores.length === 2) {
                    // Verificar que ambos jugadores estén conectados
                    const ambosConectados = sala.jugadores.every(j => j.ws && j.ws.readyState === WebSocket.OPEN)
                    
                    if (ambosConectados) {
                        const jugadoresNombres = sala.jugadores.map(j => j.nombre)
                        console.log(`🎮 Partida iniciada en sala ${sala.id}: ${jugadoresNombres[0]} vs ${jugadoresNombres[1]}`)
                        
                        sala.jugadores.forEach(j => {
                            j.ws.send(JSON.stringify({
                                tipo: "inicio",
                                jugadores: jugadoresNombres
                            }))
                        })
                        actualizarActividad(sala)
                    } else {
                        console.log(`⚠️ Sala ${sala.id} tiene jugadores desconectados, limpiando...`)
                        limpiarSalasHuérfanas()
                    }
                } else {
                    // Enviar mensaje de espera al primer jugador
                    ws.send(JSON.stringify({
                        tipo: "esperando",
                        mensaje: "Esperando oponente..."
                    }))
                }
            }

            if (data.tipo === "movimiento") {
                const sala = ws.sala
                if (!sala) {
                    ws.send(JSON.stringify({
                        tipo: "error",
                        mensaje: "No estás en una partida activa"
                    }))
                    return
                }

                // Verificar que ambos jugadores estén conectados
                const jugadoresActivos = sala.jugadores.filter(j => j.ws && j.ws.readyState === WebSocket.OPEN)
                if (jugadoresActivos.length < 2) {
                    ws.send(JSON.stringify({
                        tipo: "error",
                        mensaje: "El oponente se desconectó. Busca una nueva partida."
                    }))
                    // Limpiar esta sala
                    limpiarSalasHuérfanas()
                    return
                }

                sala.movimientos[ws.idJugador] = data.opcion
                actualizarActividad(sala)

                // Verificar si ya hay 2 movimientos
                if (Object.keys(sala.movimientos).length === 2) {
                    resolverRonda(sala)
                } else {
                    // Notificar al otro jugador que ya envió su movimiento
                    const otroJugador = sala.jugadores.find(j => j.id !== ws.idJugador)
                    if (otroJugador && otroJugador.ws && otroJugador.ws.readyState === WebSocket.OPEN) {
                        otroJugador.ws.send(JSON.stringify({
                            tipo: "esperando",
                            mensaje: "Tu oponente ya eligió, espera su resultado..."
                        }))
                    }
                }
            }

            if (data.tipo === "chat") {
                const sala = ws.sala
                if (!sala || sala.jugadores.length < 2) return

                const remitente = ws.nombreJugador || "Jugador"
                const idxRemitente = ws.idJugador

                // Enviar mensaje a TODOS los jugadores en la sala (incluyendo al remitente para consistencia)
                sala.jugadores.forEach(jugador => {
                    if (jugador.ws && jugador.ws.readyState === WebSocket.OPEN) {
                        jugador.ws.send(JSON.stringify({
                            tipo: "chat",
                            mensaje: data.mensaje,
                            remitente: remitente,
                            jugadorIndex: idxRemitente,
                            timestamp: Date.now()
                        }))
                    }
                })
                actualizarActividad(sala)
            }

            if (data.tipo === "ia") {
                const m1 = data.opcion
                const m2 = movimientoIA()
                const ganador = calcularGanador(m1, m2)

                ws.send(JSON.stringify({
                    tipo: "resultado",
                    m1,
                    m2,
                    ganador
                }))
            }

        } catch (error) {
            console.error("Error procesando mensaje:", error)
            ws.send(JSON.stringify({
                tipo: "error",
                mensaje: "Error procesando tu solicitud"
            }))
        }
    })

    ws.on("close", () => {
        jugadoresOnline--
        console.log(`🔌 Conexión cerrada. Jugadores online: ${jugadoresOnline}`)

        if (ws.sala) {
            const sala = ws.sala
            const index = sala.jugadores.findIndex(j => j.ws === ws)
            if (index !== -1) {
                const nombreDesconectado = sala.jugadores[index].nombre
                sala.jugadores.splice(index, 1)
                console.log(`👋 Jugador "${nombreDesconectado}" desconectado de sala ${sala.id}`)
                
                // Notificar al otro jugador (si existe) que el oponente se fue
                if (sala.jugadores.length === 1) {
                    const jugadorRestante = sala.jugadores[0]
                    if (jugadorRestante && jugadorRestante.ws && jugadorRestante.ws.readyState === WebSocket.OPEN) {
                        jugadorRestante.ws.send(JSON.stringify({
                            tipo: "error",
                            mensaje: "❌ Tu oponente se desconectó. Busca una nueva partida."
                        }))
                    }
                }
            }
            
            // Limpiar salas huérfanas después de cada desconexión
            setTimeout(() => limpiarSalasHuérfanas(), 1000)
        }
    })
    
    // Heartbeat para detectar conexiones muertas
    ws.on('error', (error) => {
        console.error("WebSocket error:", error)
        ws.terminate()
    })
})

// Heartbeat interval para verificar conexiones activas
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) {
            console.log("💀 Cliente inactivo, terminando conexión")
            return ws.terminate()
        }
        ws.isAlive = false
        ws.ping()
    })
}, 30000)

wss.on('close', () => {
    clearInterval(heartbeatInterval)
})

function resolverRonda(sala) {
    const m1 = sala.movimientos[0]
    const m2 = sala.movimientos[1]
    
    // Verificar que ambos movimientos existan
    if (!m1 || !m2) {
        console.log(`⚠️ Ronda incompleta en sala ${sala.id}, reiniciando movimientos`)
        sala.movimientos = {}
        return
    }

    const ganador = calcularGanador(m1, m2)

    stats.partidas++

    if (ganador !== 0) {
        const nombreGanador = sala.jugadores[ganador - 1].nombre
        ranking[nombreGanador] = (ranking[nombreGanador] || 0) + 1

        if (ranking[nombreGanador] >= 10) {
            achievements[nombreGanador] = "Maestro PPTLS"
        }
    }

    saveDB()

    console.log(`🎲 Ronda resuelta en sala ${sala.id}: ${m1} vs ${m2} -> Ganador: ${ganador}`)

    // Enviar resultado a ambos jugadores
    sala.jugadores.forEach(j => {
        if (j.ws && j.ws.readyState === WebSocket.OPEN) {
            j.ws.send(JSON.stringify({
                tipo: "resultado",
                m1,
                m2,
                ganador,
                ranking,
                stats,
                achievements
            }))
        }
    })

    // Limpiar movimientos para la siguiente ronda
    sala.movimientos = {}
    actualizarActividad(sala)
}

// Limpieza inicial al iniciar el servidor
setTimeout(() => {
    console.log("🧹 Ejecutando limpieza inicial de salas...")
    limpiarSalasHuérfanas()
}, 5000)

server.listen(PORT, () => {
    console.log("=".repeat(50))
    console.log("🎮 PPTLS SUPREME - Servidor Mejorado")
    console.log("=".repeat(50))
    console.log(`📡 Puerto: ${PORT}`)
    console.log(`✅ Chat soportado - Mensajes en tiempo real`)
    console.log(`🧹 Limpieza automática cada ${LIMPIEZA_INTERVAL / 1000} segundos`)
    console.log(`⏰ Salas expiran después de ${SALA_EXPIRACION / 1000} segundos sin actividad`)
    console.log("=".repeat(50))
})