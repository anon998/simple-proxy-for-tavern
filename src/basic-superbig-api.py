from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import re
import traceback

from superbig.base import Retriever, Chunker, Chunk, Source
from superbig.chunker import NaiveChunker
from superbig.collector import ChromaCollector
from superbig.embedder import SentenceTransformerEmbedder
from superbig.injector import GenericInjector
from superbig.provider import PseudocontextProvider
from superbig.source import TextSource


class ChatChunker(Chunker):
    def __init__(self):
        super().__init__(chunk_len=500, first_len=300, last_len=300)
        self.chunks = []

    def chunk(self, text: str) -> list[Chunk]:
        sentences = text.split("\n")
        return [Chunk(x) for x in sentences]

    def make_chunks(self, text: str) -> list[str]:
        self.chunks = self.chunk(text)
        return self.chunks

    def get_chunks(self) -> list[str]:
        return self.chunks


embedder = SentenceTransformerEmbedder()
chunker = ChatChunker()
collector = ChromaCollector(embedder)
retriever = Retriever()
injector = GenericInjector(chunker, collector, embedder, {})
provider = PseudocontextProvider(
    collector=collector,
    chunker=chunker,
    retriever=retriever,
    embedder=embedder,
    injector=injector,
)


def get_text(chatlog, search):
    start = "### Instruction:\n"
    end = "\n### Input:\n" + search + "\n### Response:\n"
    prompt = start + "[[[chatlog]]]" + end

    provider.add_source("chatlog", TextSource(chatlog))
    text = provider.with_pseudocontext(prompt)
    text = text[len(start):len(text) - len(end)]
    return text


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_error(404)

    def do_POST(self):
        try:
            content_length = int(self.headers["Content-Length"])
            body = json.loads(self.rfile.read(content_length).decode("utf-8"))

            if self.path == "/api/get-messages":
                chatlog = body["chatlog"]
                last_messages = body["last_messages"]

                text = get_text(chatlog, last_messages)
                response = json.dumps({"text": text})

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(response.encode("utf-8"))
            else:
                self.send_error(404)
        except:
            traceback.print_exc()
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = json.dumps(
                {
                    "code": 500,
                    "message": "Internal Server Error",
                }
            )
            self.wfile.write(response.encode("utf-8"))


def run_server():
    host = "127.0.0.1"
    port = 29180
    server_addr = (host, port)
    server = HTTPServer(server_addr, Handler)
    print(f"listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
