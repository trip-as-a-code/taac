//! Transitous route-provider Extism plugin for `taac`.
//!
//! Pure MOTIS query/parsing and verification logic lives in [`motis`] and [`verify`]
//! so it can be unit-tested natively. The Extism Wasm exports are compiled under
//! `#[cfg(target_arch = "wasm32")]`.

pub mod motis;
pub mod verify;

#[cfg(target_arch = "wasm32")]
#[allow(clippy::unnecessary_wraps)]
mod wasm {
    use extism_pdk::{FnResult, HttpRequest, Json, WithReturnCode, config, http, plugin_fn};
    use taac_plugin_api::{
        PlanRouteRequest, PlanRouteResponse, PluginInfo, VerifyRouteRequest, VerifyRouteResponse,
    };

    use crate::motis::{
        DEFAULT_BASE_URL, DEFAULT_PLAN_PATH, DEFAULT_USER_AGENT, MotisPlanResponse, build_plan_url,
        parse_plan_response, plugin_info,
    };
    use crate::verify::verify_against_response;

    fn cfg(key: &str, default: &str) -> String {
        config::get(key)
            .ok()
            .flatten()
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| default.to_owned())
    }

    fn fetch_plan(req: &PlanRouteRequest) -> FnResult<String> {
        let base_url = cfg("baseUrl", &cfg("base_url", DEFAULT_BASE_URL));
        let plan_path = cfg("planPath", &cfg("plan_path", DEFAULT_PLAN_PATH));
        let user_agent = cfg("user_agent", DEFAULT_USER_AGENT);
        let url = build_plan_url(&base_url, &plan_path, req);

        let http_req = HttpRequest::new(&url)
            .with_method("GET")
            .with_header("User-Agent", &user_agent)
            .with_header("Accept", "application/json");

        let res = http::request::<Vec<u8>>(&http_req, None)?;
        let status = res.status_code();
        let body =
            String::from_utf8(res.body()).map_err(|err| WithReturnCode::new(err.into(), 1))?;

        if !(200..300).contains(&status) {
            return Err(WithReturnCode::new(
                extism_pdk::Error::msg(format!(
                    "Transitous API returned HTTP {status} for {url}: {}",
                    body.chars().take(240).collect::<String>()
                )),
                1,
            ));
        }

        Ok(body)
    }

    #[plugin_fn]
    pub fn taac_plugin_info() -> FnResult<Json<PluginInfo>> {
        Ok(Json(plugin_info()))
    }

    #[plugin_fn]
    pub fn taac_route_plan(Json(req): Json<PlanRouteRequest>) -> FnResult<Json<PlanRouteResponse>> {
        let body = fetch_plan(&req)?;
        let parsed = parse_plan_response(&body, &req)?;
        Ok(Json(parsed))
    }

    #[plugin_fn]
    pub fn taac_route_verify(
        Json(req): Json<VerifyRouteRequest>,
    ) -> FnResult<Json<VerifyRouteResponse>> {
        let plan_req = PlanRouteRequest {
            from: req.from.clone(),
            to: req.to.clone(),
            time: req.start.clone(),
            arrive_by: false,
            modes: vec![req.kind],
            num_itineraries: 5,
        };
        let body = fetch_plan(&plan_req)?;
        let raw: MotisPlanResponse = serde_json::from_str(&body)?;
        let now_unix = config::get("now_unix")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<i64>().ok());
        Ok(Json(verify_against_response(&raw, &req, now_unix)))
    }
}
