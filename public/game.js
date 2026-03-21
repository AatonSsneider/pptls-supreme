const ws=new WebSocket(
location.protocol==="https:"
?`wss://${location.host}`
:`ws://${location.host}`
)

let jugador

function buscar(){

const nombre=document.getElementById("nombre").value

ws.send(JSON.stringify({
tipo:"buscar",
nombre
}))

}

function enviar(opcion){

ws.send(JSON.stringify({
tipo:"movimiento",
opcion
}))

}

function jugarIA(){

const opcion=prompt("elige piedra/papel/tijera/lagarto/spock")

ws.send(JSON.stringify({
tipo:"ia",
opcion
}))

}

ws.onmessage=msg=>{

const data=JSON.parse(msg.data)

if(data.tipo==="asignado"){
jugador=data.jugador
}

if(data.tipo==="inicio"){

document.getElementById("login").style.display="none"
document.getElementById("juego").style.display="block"

document.getElementById("jugadores").innerText=
data.jugadores[0]+" vs "+data.jugadores[1]

}

if(data.tipo==="resultado"){

document.getElementById("estado").innerText=
"Resultado: "+data.m1+" vs "+data.m2+" ganador:"+data.ganador

}

}