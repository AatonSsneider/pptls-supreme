

const express=require("express")
const http=require("http")
const WebSocket=require("ws")
const cors=require("cors")
const {v4:uuidv4}=require("uuid")
const fs=require("fs-extra")

const app=express()
const server=http.createServer(app)

// se incluyo lo siguiente
// Al inicio del archivo, después de los requires
if (process.env.NODE_ENV !== 'production') {
    // En desarrollo, permitir recargas
} else {
    // En producción, asegurar que no hay múltiples listeners
    process.on('SIGINT', () => {
        console.log('Cerrando servidor...');
        server.close(() => process.exit(0));
    });
}
// termina 

// anterior a las modificaciones - const wss=new WebSocket.Server({server})
// Modifica la línea del WebSocket  y así quedó
const wss = new WebSocket.Server({ 
    server,
    // Permitir conexiones de cualquier origen (útil para desarrollo)
    verifyClient: (info) => {
        // Puedes agregar validación de origen si lo deseas
        return true;
    }
});
// termina modificación

app.use(cors())
app.use(express.static("public"))

const PORT=process.env.PORT||3000

let salas=[]
let jugadoresOnline=0

let ranking={}
let stats={partidas:0}
let achievements={}

function loadDB(){
try{
ranking=fs.readJsonSync("./database/ranking.json")
stats=fs.readJsonSync("./database/stats.json")
achievements=fs.readJsonSync("./database/achievements.json")
}catch{}
}

function saveDB(){
fs.writeJsonSync("./database/ranking.json",ranking)
fs.writeJsonSync("./database/stats.json",stats)
fs.writeJsonSync("./database/achievements.json",achievements)
}

loadDB()

function crearSala(){
const sala={
id:uuidv4(),
jugadores:[],
movimientos:{}
}
salas.push(sala)
return sala
}

function buscarSala(){
for(let s of salas){
if(s.jugadores.length<2)return s
}
return crearSala()
}

function calcularGanador(a,b){
const reglas={
piedra:["tijera","lagarto"],
papel:["piedra","spock"],
tijera:["papel","lagarto"],
lagarto:["spock","papel"],
spock:["tijera","piedra"]
}
if(a===b)return 0
if(reglas[a].includes(b))return 1
return 2
}

function movimientoIA(){
const opciones=["piedra","papel","tijera","lagarto","spock"]
return opciones[Math.floor(Math.random()*5)]
}

wss.on("connection",ws=>{

jugadoresOnline++

ws.send(JSON.stringify({
tipo:"online",
jugadores:jugadoresOnline
}))

ws.on("message",msg=>{

const data=JSON.parse(msg)

if(data.tipo==="buscar"){

const sala=buscarSala()

const jugador={
ws,
nombre:data.nombre,
id:sala.jugadores.length
}

sala.jugadores.push(jugador)

ws.sala=sala
ws.idJugador=jugador.id

ws.send(JSON.stringify({
tipo:"asignado",
jugador:jugador.id
}))

if(sala.jugadores.length===2){

sala.jugadores.forEach(j=>{
j.ws.send(JSON.stringify({
tipo:"inicio",
jugadores:[
sala.jugadores[0].nombre,
sala.jugadores[1].nombre
]
}))
})

}

}

if(data.tipo==="movimiento"){

const sala=ws.sala
if(!sala)return

sala.movimientos[ws.idJugador]=data.opcion

if(Object.keys(sala.movimientos).length===2){
resolverRonda(sala)
}

}

if(data.tipo==="ia"){

const m1=data.opcion
const m2=movimientoIA()

const ganador=calcularGanador(m1,m2)

ws.send(JSON.stringify({
tipo:"resultado",
m1,
m2,
ganador
}))

}

})

ws.on("close",()=>{
jugadoresOnline--
})

})

function resolverRonda(sala){

const m1=sala.movimientos[0]
const m2=sala.movimientos[1]

const ganador=calcularGanador(m1,m2)

stats.partidas++

if(ganador!==0){

const nombre=sala.jugadores[ganador-1].nombre

ranking[nombre]=(ranking[nombre]||0)+1

if(ranking[nombre]>=10){
achievements[nombre]="Maestro PPTLS"
}

}

saveDB()

sala.jugadores.forEach(j=>{

j.ws.send(JSON.stringify({
tipo:"resultado",
m1,
m2,
ganador,
ranking,
stats,
achievements
}))

})

sala.movimientos={}

}

server.listen(PORT,()=>{
console.log("PPTLS SUPREME activo en puerto",PORT)
})

// se adicionaron estas lineas 
wss.on("connection", (ws, req) => {
    console.log(`Nueva conexión WebSocket desde: ${req.socket.remoteAddress}`);
    jugadoresOnline++;
    
    // ... resto del código
});

if (!server.listening) {
    server.listen(PORT, () => {
        console.log(`✅ PPTLS SUPREME activo en puerto ${PORT}`);
        console.log(`🔌 WebSocket listo para conexiones`);
    });
} else {
    console.log('Servidor ya está escuchando');
}
});