// Shared between the App target and the MatchWidget extension target.
// In Xcode: select this file → File Inspector → Target Membership: App + MatchWidget.
import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// App Group used by the app, the widget extension and the Live Activity intents.
/// Must match the App Group capability configured on BOTH targets.
let kAppGroup = "group.mt.melitafc.playingtime"

/// Minimal clock mirror. Times are absolute timestamps (ms since epoch), never counters,
/// so the clock is correct no matter how long iOS keeps the app suspended.
struct MatchClockState: Codable, Hashable {
    var matchId: String
    var title: String
    var period: Int
    var phase: String          // "pre" | "running" | "break" | "ended"
    var bankedMs: Double       // match-clock ms accumulated by finished periods
    var runningSince: Double?  // epoch ms when the current period started

    /// The wall-clock instant at which the match clock read 00:00 (only meaningful while running).
    var clockZero: Date? {
        guard let rs = runningSince else { return nil }
        return Date(timeIntervalSince1970: (rs - bankedMs) / 1000)
    }
    var bankedText: String {
        let s = Int(bankedMs / 1000)
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}

struct QueuedAction: Codable {
    var type: String // "start" | "period"
    var at: Double   // epoch ms of the tap
}

/// State + action queue stored in the shared App Group, so a tap on the lock screen is
/// recorded with its timestamp even if the WebView is suspended or the app was killed.
enum MatchStore {
    private static var defaults: UserDefaults { UserDefaults(suiteName: kAppGroup) ?? .standard }

    static func load() -> MatchClockState? {
        guard let d = defaults.data(forKey: "clock") else { return nil }
        return try? JSONDecoder().decode(MatchClockState.self, from: d)
    }
    static func save(_ s: MatchClockState?) {
        if let s, let d = try? JSONEncoder().encode(s) { defaults.set(d, forKey: "clock") }
        else { defaults.removeObject(forKey: "clock") }
    }
    static func enqueue(_ a: QueuedAction) {
        var q = queue()
        q.append(a)
        if let d = try? JSONEncoder().encode(q) { defaults.set(d, forKey: "queue") }
    }
    static func queue() -> [QueuedAction] {
        guard let d = defaults.data(forKey: "queue") else { return [] }
        return (try? JSONDecoder().decode([QueuedAction].self, from: d)) ?? []
    }
    static func drain() -> [QueuedAction] {
        let q = queue()
        defaults.removeObject(forKey: "queue")
        return q
    }

    /// Same rules as the JS engine: START only when stopped, PERIOD only when running.
    static func apply(_ type: String, at: Double) -> MatchClockState? {
        guard var s = load() else { return nil }
        switch type {
        case "start" where s.phase == "pre" || s.phase == "break":
            s.period += 1
            s.phase = "running"
            s.runningSince = at
        case "period" where s.phase == "running":
            s.bankedMs += max(0, at - (s.runningSince ?? at))
            s.runningSince = nil
            s.phase = "break"
        default:
            return nil
        }
        save(s)
        enqueue(QueuedAction(type: type, at: at))
        return s
    }
}

#if canImport(ActivityKit)
@available(iOS 16.1, *)
struct MatchActivityAttributes: ActivityAttributes {
    public typealias ContentState = MatchClockState
    var matchId: String
}
#endif
