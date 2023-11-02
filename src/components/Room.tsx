import { useCallback, useEffect, useState } from "react"
import toast from "react-hot-toast"
import socket from "utils/socket"
import Candle from "components/Candle"
import User from "types/User"
import { useUser } from "context/UserContext"
import { useParams } from "react-router-dom"
import Lobby from "./Lobby"
import clsx from "clsx"
import { getInitialDice, getUserPositionClasses } from "utils/helpers"
import { DndContext, DragEndEvent, DragStartEvent } from "@dnd-kit/core"
import DroppableDicePool from "./DroppableDicePool"
import Die from "types/Die"
import DicePool from "enums/DicePool"
import { HOPE_DIE_ID } from "utils/constants"

export default function Room() {
  const { username, isGm } = useUser()
  const { room } = useParams()

  const [users, setUsers] = useState<User[]>([])
  const [candles, setCandles] = useState<boolean[]>(Array(10).fill(false))
  const [dicePools, setDicePools] = useState<{ [key in DicePool]: Die[] }>({
    [DicePool.Player]: getInitialDice(),
    [DicePool.GM]: [],
    [DicePool.Stash]: [{ id: HOPE_DIE_ID, num: 1 }],
  })
  const [draggingDice, setDraggingDice] = useState<{ dieId: number; username: string }[]>([])
  console.log(candles)
  const transferDieToNewPool = useCallback((dieId, prevDicePool, newDicePool) => {
    setDicePools((prevState) => {
      const newState = { ...prevState }
      // remove die from the pool that the drag started in
      const index = newState[prevDicePool].findIndex((die) => die.id === dieId)
      if (index > -1) {
        const [die] = newState[prevDicePool].splice(index, 1)
        // add die to the pool that the drag ended in
        newState[newDicePool].push(die)
      }
      return newState
    })
  }, [])

  useEffect(() => {
    function initSocket() {
      console.log("init socket", socket)
      socket.connect()

      socket.on("connect", () => {
        socket.emit("userJoined", { username, room, isGm })
      })
    }
    if (username) initSocket()

    return () => {
      if (socket) {
        socket.removeAllListeners()
        socket.disconnect()
      }
    }
  }, [isGm, room, username])

  useEffect(() => {
    socket.on("usersUpdated", ({ updatedUsers, toastText }) => {
      // reorder users so that this user is first in the array
      const reorderedUsers: User[] = []
      const userIndex = updatedUsers.findIndex((user) => user.name === username)

      for (let index = userIndex, reorderedIndex = 0; reorderedIndex < updatedUsers.length; index++, reorderedIndex++) {
        if (index === updatedUsers.length) index = 0
        reorderedUsers[reorderedIndex] = updatedUsers[index]
      }
      setUsers(reorderedUsers)

      if (isGm) {
        console.log("gm passInitialDicePoolsAndCandles")

        socket.emit("passInitialDicePoolsAndCandles", { room, dicePools, candles })
      }
      if (toastText) toast(toastText)
    })

    socket.on("passedInitialDicePoolsAndCandles", ({ dicePools: _dicePools, candles: _candles }) => {
      console.log("passedInitialDicePoolsAndCandles", _dicePools)
      setDicePools(_dicePools)
      setCandles(_candles)
    })

    socket.on("candleChanged", ({ index, isLit, username: _username }) => {
      setCandles((prevState) => {
        const newState = [...prevState]
        newState[index] = isLit
        return newState
      })
      if (_username !== username) {
        toast(`${_username} ${isLit ? "lit" : "extinguished"} a candle.`)
      }
    })

    socket.on("rolled", ({ dicePool, dice, username: _username }) => {
      setDicePools((prevState) => {
        const newState = { ...prevState }
        dice.forEach((d, i) => (newState[dicePool][i].num = d))
        return newState
      })
      if (_username !== username) {
        toast(`${username} rolled the ${dicePool}.`)
      }
    })

    socket.on("dragStarted", ({ username, dieId }) => {
      setDraggingDice((prevState) => [...prevState, { dieId, username }])
    })

    socket.on("dragEnded", ({ prevDicePool, newDicePool, dieId }) => {
      setDraggingDice((prevState) => {
        const newState = [...prevState]
        const index = newState.findIndex((entry) => entry.dieId === dieId)
        if (index > -1) {
          newState.splice(index, 1)
        }
        return newState
      })
      transferDieToNewPool(dieId, prevDicePool, newDicePool)
    })

    return () => {
      socket.removeAllListeners()
    }
  }, [candles, dicePools, isGm, room, transferDieToNewPool, username])

  if (!username) {
    return <Lobby room={room} />
  }

  function handleDragStart(event: DragStartEvent) {
    let dicePool = DicePool.Player

    if (dicePools[DicePool.GM].find((die) => die.id === event.active.id)) {
      dicePool = DicePool.GM
    } else if (dicePools[DicePool.Stash].find((die) => die.id === event.active.id)) {
      dicePool = DicePool.Stash
    }

    socket.emit("dragStart", { username, room, dieId: event.active.id, dicePool })
  }

  function handleDragEnd(event: DragEndEvent) {
    const newDicePool = event.over?.id
    if (!newDicePool) return

    let prevDicePool = DicePool.Player
    if (dicePools[DicePool.GM].find((die) => die.id === event.active.id)) {
      prevDicePool = DicePool.GM
    } else if (dicePools[DicePool.Stash].find((die) => die.id === event.active.id)) {
      prevDicePool = DicePool.Stash
    }
    transferDieToNewPool(event.active.id, prevDicePool, newDicePool)

    socket.emit("dragEnd", { username, room, dieId: event.active.id, prevDicePool, newDicePool })
  }

  function handleRoll(dicePool: DicePool) {
    socket.emit("roll", { dicePool, diceCount: dicePools[dicePool].length, username, room })
  }

  function handleCandleToggle(index) {
    socket.emit("candleChange", { index, isLit: !candles[index], username, room })
  }

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {/* users */}
      <div className="absolute w-full h-full">
        {users.map((user, i) => (
          <div
            key={user.name}
            className={clsx(getUserPositionClasses(i, users.length), "absolute text-center text-yellow")}
          >
            {user.name}
          </div>
        ))}
      </div>
      {/* table */}
      <div
        className="bg-[length:250px] absolute w-[105%] h-[105%] rounded-[100%]"
        style={{
          background: "radial-gradient(ellipse at center, rgba(255, 207, 74, 1) 0%, rgba(255, 207, 74, 0) 67%",
        }}
      />
      <div
        className="bg-[url('/public/wood.png')] bg-[length:250px] absolute w-11/12 h-5/6 rounded-[100%]"
        style={{ imageRendering: "pixelated" }}
      />
      {/* candles */}
      <div className="relative w-full h-full scale-75 mb-10">
        {candles.map((isLit, i) => (
          <Candle key={i} index={i} isLit={isLit} onToggle={() => handleCandleToggle(i)} />
        ))}
      </div>
      {/* dice */}
      <div className="absolute w-[50%] xl:w-[60%] h-[55%] flex justify-center">
        <div className="relative w-full">
          <DroppableDicePool
            dicePool={DicePool.Player}
            dice={dicePools[DicePool.Player]}
            draggingDice={draggingDice}
            showRollButton={!isGm}
            onRoll={() => handleRoll(DicePool.Player)}
            moreClasses="p-2 pt-0 h-[50%] border-b-6 border-brown"
          />
          <DroppableDicePool
            dicePool={DicePool.GM}
            dice={dicePools[DicePool.GM]}
            draggingDice={draggingDice}
            showRollButton={isGm}
            onRoll={() => handleRoll(DicePool.GM)}
            moreClasses="p-2 pb-0 h-[50%]"
          />
        </div>
        <DroppableDicePool
          dicePool={DicePool.Stash}
          dice={dicePools[DicePool.Stash]}
          draggingDice={draggingDice}
          moreClasses="p-2 my-12 border-l-6 border-brown"
        />
      </div>
    </DndContext>
  )
}
