import Gio from "gi://Gio";
import GLib from "gi://GLib";

export class SpotDLExecutor {
  constructor() {
    this.cancellable = new Gio.Cancellable();
  }

  downloadSong(metadata, onOutput, onComplete) {
    let args = ["spotdl"];

    if (metadata.output) {
      args.push("--output", metadata.output);
    }

    args.push("--simple-tui");

    if (metadata.url) {
      args.push(metadata.url);
    } else if (metadata.query) {
      args.push(metadata.query);
    }
    console.log(metadata.url);

    console.log("Executing command", args);

    this._executeCommand(args, onOutput, onComplete);
  }

  executeCustomCommand(args, onOutput, onComplete) {
    let fullArgs = ["spotdl", ...args];
    this._executeCommand(fullArgs, onOutput, onComplete);
  }

  _executeCommand(args, onOutput, onComplete) {
    try {
      let proc = Gio.Subprocess.new(
        args,
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
      );

      this._readStream(proc.get_stdout_pipe(), "STDOUT", onOutput);

      this._readStream(proc.get_stderr_pipe(), "STDERR", onOutput);

      proc.wait_async(this.cancellable, (proc, result) => {
        try {
          proc.wait_finish(result);
          let exitCode = proc.get_exit_status();

          if (onComplete) {
            onComplete({
              success: exitCode === 0,
              exitCode: exitCode,
            });
          }
        } catch (e) {
          if (onComplete) {
            onComplete({
              success: false,
              error: e.message,
            });
          }
          console.warn(e, "Process wait failed");
        }
      });
    } catch (e) {
      if (onOutput) {
        onOutput({
          type: "ERROR",
          message: `Failed to start process: ${e.message}`,
        });
      }
      if (onComplete) {
        onComplete({ success: false, error: e.message });
      }
      console.warn(e, "Failed to execute command");
    }
  }

  _readStream(stream, type, onOutput) {
    if (!stream || !onOutput) return;

    let dataInputStream = new Gio.DataInputStream({
      base_stream: stream,
      close_base_stream: true,
    });

    this._readLineAsync(dataInputStream, type, onOutput);
  }

  _readLineAsync(dataInputStream, type, onOutput) {
    dataInputStream.read_line_async(
      GLib.PRIORITY_DEFAULT,
      this.cancellable,
      (stream, result) => {
        try {
          let [line] = stream.read_line_finish_utf8(result);

          if (line !== null) {
            onOutput({
              type: type,
              message: line,
            });

            this._readLineAsync(dataInputStream, type, onOutput);
          }
        } catch (e) {
          if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
            console.warn(e, "Error reading stream");
          }
        }
      },
    );
  }

  cancel() {
    this.cancellable.cancel();
    this.cancellable = new Gio.Cancellable();
  }

  checkSpotDLInstalled(callback) {
    try {
      let proc = Gio.Subprocess.new(
        ["which", "spotdl"],
        Gio.SubprocessFlags.STDOUT_PIPE,
      );

      proc.wait_async(null, (proc, result) => {
        try {
          proc.wait_finish(result);
          let exitCode = proc.get_exit_status();
          callback(exitCode === 0);
        } catch (e) {
          callback(false);
        }
      });
    } catch (e) {
      callback(false);
    }
  }

  destroy() {
    this.cancel();
  }
}
