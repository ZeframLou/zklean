use anyhow::{bail, Context, Result};
use std::io::{self, Read, Write};
use zklean_core::ProveInput;

#[cfg(feature = "execute")]
mod execute;
#[cfg(feature = "prover")]
mod sp1;

// Native libraries, including upstream gnark, print diagnostics to fd 1.
// Reserve the original stdout for our JSON protocol before invoking them.
fn json_output() -> Result<Box<dyn Write>> {
    #[cfg(unix)]
    {
        use std::os::fd::AsFd;
        let output = std::fs::File::from(io::stdout().as_fd().try_clone_to_owned()?);
        if unsafe { libc::dup2(libc::STDERR_FILENO, libc::STDOUT_FILENO) } < 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(Box::new(output))
    }
    #[cfg(not(unix))]
    {
        Ok(Box::new(io::stdout()))
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Identify {
    export: String,
    names: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Export {
    export: String,
}

/// Checking runs with about the SP1 guest's 2 MiB stack, so an export that
/// checks here is unlikely to exhaust the guest's. Native and RISC-V frames
/// differ, so the limit is approximate.
fn guest_stack<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    std::thread::Builder::new()
        .stack_size(2 << 20)
        .spawn(f)?
        .join()
        .map_err(|_| anyhow::anyhow!("check panicked"))?
}

fn main() -> Result<()> {
    let mut output = json_output()?;
    let command = std::env::args()
        .nth(1)
        .context("usage: zklean-native COMMAND < request.json")?;
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let result = match command.as_str() {
        "check" => {
            let request: ProveInput = serde_json::from_str(&input)?;
            serde_json::to_value(guest_stack(move || zklean_core::check(&request))?)?
        }
        // The statement digest, so tests can compare Rust and TypeScript.
        "commitment" => {
            let statement: zklean_core::Statement = serde_json::from_str(&input)?;
            let digest = zklean_core::commitment(&statement)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            serde_json::json!({"commitment": digest})
        }
        "requirements" => {
            let request: ProveInput = serde_json::from_str(&input)?;
            serde_json::to_value(guest_stack(move || zklean_core::requirements(&request))?)?
        }
        #[cfg(feature = "prover")]
        "prove" | "identity" => sp1::run(&command, &input)?,
        "kernel" => {
            let request: Export = serde_json::from_str(&input)?;
            serde_json::to_value(guest_stack(move || {
                zklean_core::kernel_identities(&request.export)
            })?)?
        }
        "identify" => {
            let request: Identify = serde_json::from_str(&input)?;
            serde_json::to_value(guest_stack(move || {
                zklean_core::identify(&request.export, &request.names)
            })?)?
        }
        #[cfg(feature = "execute")]
        "execute" => execute::run(&input)?,
        _ => bail!("unsupported command"),
    };
    writeln!(output, "{}", serde_json::to_string(&result)?)?;
    Ok(())
}
