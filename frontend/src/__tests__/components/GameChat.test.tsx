import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import GameChat from "@/components/GameChat";

// Mock the socket client
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

vi.mock("@/sockets/socketClient", () => ({
  getSocket: () => mockSocket,
}));
vi.mock("@/sockets/roomHandlers", () => ({
  subscribeToRoomEvent: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => {
    mockSocket.on(event, listener);
    return () => mockSocket.off(event, listener);
  },
}));

function chatMessageListener() {
  const call = mockSocket.on.mock.calls.find(
    ([event]) => event === "chat_message",
  );
  if (!call) throw new Error("No chat_message listener registered");
  return call[1] as (message: {
    userId: number;
    username: string;
    message: string;
    timestamp: string;
  }) => void;
}

describe("GameChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the toggle button", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);
    // Should have a button (the chat toggle)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it("chat panel is hidden by default", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);
    // The panel should not be visible initially
    expect(screen.queryByText("Chat di gioco")).not.toBeInTheDocument();
  });

  it("opens chat panel when toggle button is clicked", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);
    const toggleBtn = screen.getAllByRole("button")[0];

    act(() => {
      fireEvent.click(toggleBtn);
    });

    expect(screen.getByText("Chat di gioco")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Scrivi un messaggio...")
    ).toBeInTheDocument();
  });

  it("shows empty state message when no messages exist", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);
    const toggleBtn = screen.getAllByRole("button")[0];

    act(() => {
      fireEvent.click(toggleBtn);
    });

    expect(
      screen.getByText("Nessun messaggio. Inizia la conversazione!")
    ).toBeInTheDocument();
  });

  it("send button is disabled when input is empty", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);
    const toggleBtn = screen.getAllByRole("button")[0];

    act(() => {
      fireEvent.click(toggleBtn);
    });

    // Find the send button (the last button in the chat panel)
    const buttons = screen.getAllByRole("button");
    const sendBtn = buttons[buttons.length - 1];
    expect(sendBtn).toBeDisabled();
  });

  it("send button is enabled when input has text", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);
    const toggleBtn = screen.getAllByRole("button")[0];

    act(() => {
      fireEvent.click(toggleBtn);
    });

    const input = screen.getByPlaceholderText("Scrivi un messaggio...");
    act(() => {
      fireEvent.change(input, { target: { value: "Ciao!" } });
    });

    const buttons = screen.getAllByRole("button");
    const sendBtn = buttons[buttons.length - 1];
    expect(sendBtn).not.toBeDisabled();
  });

  it("emits send_chat_message when send button is clicked", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);
    const toggleBtn = screen.getAllByRole("button")[0];

    act(() => {
      fireEvent.click(toggleBtn);
    });

    const input = screen.getByPlaceholderText("Scrivi un messaggio...");
    act(() => {
      fireEvent.change(input, { target: { value: "Ciao!" } });
    });

    const buttons = screen.getAllByRole("button");
    const sendBtn = buttons[buttons.length - 1];
    act(() => {
      fireEvent.click(sendBtn);
    });

    expect(mockSocket.emit).toHaveBeenCalledWith("send_chat_message", {
      message: "Ciao!",
    });
  });

  it("clears input after sending", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);
    const toggleBtn = screen.getAllByRole("button")[0];

    act(() => {
      fireEvent.click(toggleBtn);
    });

    const input = screen.getByPlaceholderText(
      "Scrivi un messaggio..."
    ) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "Hello" } });
    });

    const buttons = screen.getAllByRole("button");
    const sendBtn = buttons[buttons.length - 1];
    act(() => {
      fireEvent.click(sendBtn);
    });

    expect(input.value).toBe("");
  });

  it("sends message on Enter key press", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);
    const toggleBtn = screen.getAllByRole("button")[0];

    act(() => {
      fireEvent.click(toggleBtn);
    });

    const input = screen.getByPlaceholderText("Scrivi un messaggio...");
    act(() => {
      fireEvent.change(input, { target: { value: "Enter test" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    });

    expect(mockSocket.emit).toHaveBeenCalledWith("send_chat_message", {
      message: "Enter test",
    });
  });

  it("does not send on Shift+Enter (allows newline)", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);
    const toggleBtn = screen.getAllByRole("button")[0];

    act(() => {
      fireEvent.click(toggleBtn);
    });

    const input = screen.getByPlaceholderText("Scrivi un messaggio...");
    act(() => {
      fireEvent.change(input, { target: { value: "No send" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: true });
    });

    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it("does not emit when userId is null", () => {
    render(<GameChat roomCode="ABCD" userId={null} />);
    const toggleBtn = screen.getAllByRole("button")[0];

    act(() => {
      fireEvent.click(toggleBtn);
    });

    const input = screen.getByPlaceholderText("Scrivi un messaggio...");
    act(() => {
      fireEvent.change(input, { target: { value: "no user" } });
    });

    const buttons = screen.getAllByRole("button");
    const sendBtn = buttons[buttons.length - 1];
    act(() => {
      fireEvent.click(sendBtn);
    });

    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it("does not emit when roomCode is empty", () => {
    render(<GameChat roomCode="" userId={1} />);
    const toggleBtn = screen.getAllByRole("button")[0];

    act(() => {
      fireEvent.click(toggleBtn);
    });

    const input = screen.getByPlaceholderText("Scrivi un messaggio...");
    act(() => {
      fireEvent.change(input, { target: { value: "no room" } });
    });

    const buttons = screen.getAllByRole("button");
    const sendBtn = buttons[buttons.length - 1];
    act(() => {
      fireEvent.click(sendBtn);
    });

    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it("registers chat_message listener on mount", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);
    expect(mockSocket.on).toHaveBeenCalledWith(
      "chat_message",
      expect.any(Function)
    );
  });

  it("unregisters chat_message listener on unmount", () => {
    const { unmount } = render(
      <GameChat roomCode="ABCD" userId={1} />
    );
    unmount();
    expect(mockSocket.off).toHaveBeenCalledWith(
      "chat_message",
      expect.any(Function)
    );
  });

  it("displays received messages correctly", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);

    // Get the handler that was registered
    const chatMessageHandler = chatMessageListener();

    // Open chat
    const toggleBtn = screen.getAllByRole("button")[0];
    act(() => {
      fireEvent.click(toggleBtn);
    });

    // Simulate receiving a message from another user
    act(() => {
      chatMessageHandler({
        userId: 2,
        username: "otherplayer",
        message: "Buona fortuna!",
        timestamp: new Date().toISOString(),
      });
    });

    expect(screen.getByText("otherplayer")).toBeInTheDocument();
    expect(screen.getByText("Buona fortuna!")).toBeInTheDocument();
  });

  it("shows unread badge when messages arrive while chat is closed", () => {
    render(<GameChat roomCode="ABCD" userId={1} />);

    // Get the handler
    const chatMessageHandler = chatMessageListener();

    // Send a message while chat is closed
    act(() => {
      chatMessageHandler({
        userId: 2,
        username: "other",
        message: "Hey",
        timestamp: new Date().toISOString(),
      });
    });

    // Should show unread count badge
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
