import http, { IncomingMessage } from "http";
import url from "url";
import net from "net";

const HttpPort = process.argv[2] || 3128;
const ProxyURL = process.argv[3] || null;
const ProxyHost = ProxyURL ? url.parse(ProxyURL).hostname : null;
const ProxyPort = ProxyURL ? url.parse(ProxyURL).port || 80 : null;

const onError = (
  error: Error,
  message: string,
  url: string,
  socket: net.Socket
) => {
  if (socket) socket.end();
  console.error(
    "%s %s: %s",
    new Date().toLocaleTimeString(),
    message,
    url,
    error + ""
  );
};

const server = http
  .createServer((clientRequest, clientResponse) => {
    let serverSocket: net.Socket;
    const clientSocket = clientRequest.socket;
    if (clientRequest.url) {
      const x = url.parse(clientRequest.url);
      const serverRequest = http.request(
        {
          host: ProxyHost || x.hostname,
          port: ProxyPort || x.port || 80,
          path: ProxyURL ? clientRequest.url : x.path,
          method: clientRequest.method,
          headers: clientRequest.headers,
          // @ts-ignore
          agent: clientSocket.$agent,
        },
        (serverResponse) => {
          if (serverResponse.statusCode) {
            serverSocket = serverResponse.socket;
            clientResponse.writeHead(
              serverResponse.statusCode,
              serverResponse.headers
            );
            serverResponse.pipe(clientResponse);
          }
        }
      );

      clientRequest.pipe(serverRequest);
      serverRequest.on("error", (error) => {
        clientResponse.writeHead(400, error.message, {
          "content-type": "text/html",
        });
        clientResponse.end(
          "<h1>" + error.message + "<br/>" + clientRequest.url + "</h1>"
        );
        onError(
          error,
          "server request",
          x.hostname + ":" + (x.port || 80),
          serverSocket
        );
      });
    }
  })
  .on(
    "connect",
    (
      clientRequest: IncomingMessage,
      clientSocket: net.Socket,
      clientHeader: Buffer
    ) => {
      let serverSocket: net.Socket;
      if (clientRequest.url) {
        if (ProxyURL) {
          const serverRequest = http.request({
            host: ProxyHost,
            port: ProxyPort,
            path: clientRequest.url,
            method: clientRequest.method,
            headers: clientRequest.headers,
            // @ts-ignore
            agent: clientSocket.$agent,
          });
          serverRequest.end();
          serverRequest.on(
            "connect",
            (serverResponse, serverSocket2, svrHead) => {
              serverSocket = serverSocket2;
              clientSocket.write("HTTP/1.0 200 Connection established\r\n\r\n");
              if (clientHeader && clientHeader.length)
                serverSocket.write(clientHeader);
              if (svrHead && svrHead.length) clientSocket.write(svrHead);
              serverSocket.pipe(clientSocket);
              clientSocket.pipe(serverSocket);
              serverSocket.on("error", (error) =>
                onError(error, "server socket", "", clientSocket)
              );
            }
          );
          serverRequest.on("error", (error) =>
            onError(error, "server request 2", "", clientSocket)
          );
        } else {
          const x = url.parse("https://" + clientRequest.url);
          serverSocket = net.connect(
            x.port ? Number(x.port) : 443,
            x.hostname || undefined,
            async () => {
              clientSocket.write("HTTP/1.0 200 Connection established\r\n\r\n");
              if (clientHeader && clientHeader.length) {
                serverSocket.write(clientHeader);
              }
              clientSocket.pipe(serverSocket);
            }
          );

          serverSocket.pipe(clientSocket);
          serverSocket.on("error", (error) =>
            onError(error, "serverSocket", "", clientSocket)
          );
        }
        clientSocket.on("error", (error: Error) =>
          onError(error, "clientSocket", "", serverSocket)
        );
      }
    }
  )
  .on("connection", (clientSocket) => {
    // @ts-ignore
    clientSocket.$agent = new http.Agent({ keepAlive: true });
    // @ts-ignore
    clientSocket.$agent.on("error", (error) => console.log("agent:", error));
  });

server.listen(HttpPort, () => console.info("proxy server on port " + HttpPort));
