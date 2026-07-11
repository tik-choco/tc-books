import { render } from "preact";
import "./index.css";
import { App } from "./app.tsx";
import { writeAppManifest } from "./lib/appManifest";
import { BUS_VERSION } from "./lib/sharedBus";
import { startBooksBackupPublisher } from "./lib/booksBackupPublisher";

render(<App />, document.getElementById("app")!);

writeAppManifest({
  app: "tc-books",
  busVersion: BUS_VERSION,
  publishes: ["books-backup"],
  consumes: [],
  reads: [],
});

// Mirror every ledger change into tc-storage's drive (encrypted, debounced).
startBooksBackupPublisher();
