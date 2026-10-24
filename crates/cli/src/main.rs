use anyhow::{bail, Context, Result};
use std::io::{self, Read, Write};
use zklean_core::ProveInput;

#[cfg(feature = "execute")]
mod execute;
#[cfg(feature = "prover")]
mod sp1;
mod verify;

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

fn main() -> Result<()> {
    let mut output = json_output()?;
    let command = std::env::args()
        .nth(1)
        .context("usage: zklean-native check|prove|verify < request.json")?;
    if command == "prove" {
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "warn,sp1_prover=info,sp1_sdk=info".into()),
            )
            .with_writer(io::stderr)
            .with_span_events(tracing_subscriber::fmt::format::FmtSpan::CLOSE)
            .with_ansi(false)
            .init();
    }
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let result = match command.as_str() {
        "check" => {
            let request: ProveInput = serde_json::from_str(&input)?;
            serde_json::to_value(zklean_core::check(&request)?)?
        }
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
            serde_json::json!({"format": "zklean/requirements/1", "specs": zklean_core::requirements(&request)?})
        }
        #[cfg(feature = "prover")]
        "prove" | "identity" => sp1::run(&command, &input)?,
        "verify" => verify::run(&input)?,
        #[cfg(feature = "execute")]
        "execute" => execute::run(&input)?,
        _ => bail!("unsupported command"),
    };
    writeln!(output, "{}", serde_json::to_string(&result)?)?;
    Ok(())
}
