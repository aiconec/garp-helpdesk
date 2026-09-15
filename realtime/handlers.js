function helpdesk_handlers(socket) {
  // Every one of these rooms is keyed on a ticket id, and HD Ticket is named by
  // an auto-incrementing integer, so the rooms are trivially enumerable. The
  // framework's own doc_open handler checks permission before joining; this
  // file joined directly, which let any connected socket -- an agent, a portal
  // website user, or anyone else the namespace admits -- receive ticket
  // updates, comments, the list of agent email addresses viewing a ticket and
  // typing indicators, for every ticket in the tenant.
  //
  // Fail closed: if the framework's helper is not attached for any reason, the
  // callback simply does not run.
  const with_ticket_permission = (ticket_id, fn) => {
    if (!ticket_id) return;
    if (typeof socket.has_permission !== "function") return;
    socket
      .has_permission("HD Ticket", ticket_id)
      .then(() => fn())
      .catch(() => {});
  };

  socket.on("ping", () => {
    socket.emit("pong");
  });

  socket.on("view_ticket", (ticket_id) => {
    with_ticket_permission(ticket_id, () => {
      const room = open_doc_room("HD Ticket", ticket_id);
      socket.join(room);

      // Notify all viewers in this ticket room about the new viewer
      notify_ticket_viewers({
        socket: socket,
        ticket_id: ticket_id,
      });
    });
  });

  socket.on("stop_view_ticket", (ticket_id) => {
    if (!ticket_id) return;
    const room = open_doc_room("HD Ticket", ticket_id);
    socket.leave(room);

    // Notify remaining viewers that someone left
    notify_ticket_viewers({
      socket: socket,
      ticket_id: ticket_id,
    });
  });

  socket.on("ticket_get_viewers", (ticket_id) => {
    with_ticket_permission(ticket_id, () => {
      // Send current viewers list to the requesting user only
      notify_ticket_viewers({
        socket: socket,
        ticket_id: ticket_id,
        toUser: true, // saying that whenever we ask for viewers, send only to the user who asked
      });
    });
  });

  socket.on("notify_ticket_update", (ticket_id, field, value) => {
    if (!field) return;
    // Still a client-driven relay, but now only between people who may read the
    // ticket. Emitting from the server when the document actually changes would
    // be better; this is the smaller change that closes the arbitrary-room and
    // arbitrary-ticket abuse.
    with_ticket_permission(ticket_id, () => {
      const ticket_room = open_doc_room("HD Ticket", ticket_id);
      socket.to(ticket_room).emit("ticket_update", {
        ticket_id,
        user: socket.user,
        field,
        value,
      });
    });
  });

  // Typing indicators
  socket.on("helpdesk_ticket_typing", (ticket_id) => {
    with_ticket_permission(ticket_id, () => {
      const ticket_room = open_doc_room("HD Ticket", ticket_id);

      // Broadcast to all other users in the ticket room that this user is typing
      socket.to(ticket_room).emit("helpdesk_ticket_typing", {
        ticket_id,
        user: socket.user,
      });
    });
  });

  socket.on("helpdesk_ticket_typing_stopped", (ticket_id) => {
    with_ticket_permission(ticket_id, () => {
      const ticket_room = open_doc_room("HD Ticket", ticket_id);

      // Broadcast to all other users in the ticket room that this user stopped typing
      socket.to(ticket_room).emit("helpdesk_ticket_typing_stopped", {
        ticket_id,
        user: socket.user,
      });
    });
  });
}

function notify_ticket_viewers(args) {
  if (!(args && args.socket && args.ticket_id)) return;

  const socket = args.socket;
  const ticket_id = args.ticket_id;

  const ticket_room = open_doc_room("HD Ticket", ticket_id);

  const clients = Array.from(socket.nsp.adapter.rooms.get(ticket_room) || []);

  let users = [];

  // Extract user information for each socket in the room
  socket.nsp.sockets.forEach((sock) => {
    if (clients.includes(sock.id)) {
      users.push(sock.user);
    }
  });

  const target_room = args.toUser
    ? user_room(args.socket.user) // Send to specific user only
    : ticket_room; // Send to all viewers in the ticket room

  // Emit the notification with current viewers list
  socket.nsp.to(target_room).emit("ticket_viewers", {
    ticket_id,
    users: JSON.stringify(Array.from(new Set(users))), // Remove duplicate users
    total_viewers: Array.from(new Set(users)).length,
  });
}

// Helper functions
const open_doc_room = (doctype, docname) =>
  "open_doc:" + doctype + "/" + docname;
const user_room = (user) => "user:" + user;
const ticket_response_room = (ticket_id) => "ticket_response:" + ticket_id;

module.exports = helpdesk_handlers;
