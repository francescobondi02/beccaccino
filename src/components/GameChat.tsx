import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, X, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSocket } from "@/sockets/socketClient";
import { subscribeToRoomEvent } from "@/sockets/roomHandlers";
import type { ChatMessagePayload } from "@/sockets/events";

type ChatMessage = ChatMessagePayload;

interface GameChatProps {
  roomCode: string;
  userId: number | null;
}

const GameChat = ({ roomCode, userId }: GameChatProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isOpenRef = useRef(false);

  // Keep ref in sync
  useEffect(() => {
    isOpenRef.current = isOpen;
    if (isOpen) {
      setUnreadCount(0);
    }
  }, [isOpen]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for chat messages
  useEffect(() => {
    const handleChatMessage = (data: ChatMessage) => {
      setMessages((prev) => [...prev.slice(-99), data]); // Keep last 100 messages
      if (!isOpenRef.current) {
        setUnreadCount((prev) => prev + 1);
      }
    };

    return subscribeToRoomEvent("chat_message", handleChatMessage);
  }, []);

  const handleSend = () => {
    if (!inputValue.trim() || !userId || !roomCode) return;

    const socket = getSocket();
    socket.emit("send_chat_message", {
      roomCode,
      message: inputValue.trim(),
    });

    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <>
      {/* Toggle Button */}
      <Button
        variant="secondary"
        size="sm"
        className="relative"
        onClick={() => setIsOpen(!isOpen)}
      >
        <MessageCircle className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-16 right-4 z-40 w-80 h-96 bg-card border-2 border-border rounded-lg shadow-2xl flex flex-col overflow-hidden animate-card-from-bottom">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-secondary/50 border-b border-border">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Chat di gioco</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground text-center mt-8">
                Nessun messaggio. Inizia la conversazione!
              </p>
            )}
            {messages.map((msg, idx) => {
              const isMe = msg.userId === userId;
              return (
                <div
                  key={idx}
                  className={cn(
                    "flex flex-col",
                    isMe ? "items-end" : "items-start",
                  )}
                >
                  {!isMe && (
                    <span className="text-[10px] text-muted-foreground mb-0.5 px-1">
                      {msg.username}
                    </span>
                  )}
                  <div
                    className={cn(
                      "max-w-[75%] px-3 py-1.5 rounded-lg text-sm break-words",
                      isMe
                        ? "bg-primary text-primary-foreground rounded-br-none"
                        : "bg-secondary text-foreground rounded-bl-none",
                    )}
                  >
                    {msg.message}
                  </div>
                  <span className="text-[9px] text-muted-foreground mt-0.5 px-1">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-secondary/30">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Scrivi un messaggio..."
              className="flex-1 h-8 text-sm bg-card border-border"
              maxLength={200}
            />
            <Button
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleSend}
              disabled={!inputValue.trim()}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

export default GameChat;
