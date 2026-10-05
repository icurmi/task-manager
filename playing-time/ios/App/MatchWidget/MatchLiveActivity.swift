// Lock-screen Live Activity + Dynamic Island for a running match.
import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct MatchWidgetBundle: WidgetBundle {
    var body: some Widget {
        MatchLiveActivity()
    }
}

struct MatchLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MatchActivityAttributes.self) { context in
            LockScreenView(state: context.state)
                .activityBackgroundTint(Color(red: 0.04, green: 0.12, blue: 0.23))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(periodLabel(context.state)).font(.headline).foregroundStyle(.yellow)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ClockText(state: context.state).font(.title2.monospacedDigit().bold())
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.title).font(.caption).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Controls(state: context.state)
                }
            } compactLeading: {
                Text("P\(max(context.state.period, 1))").bold().foregroundStyle(.yellow)
            } compactTrailing: {
                ClockText(state: context.state).monospacedDigit().frame(maxWidth: 64)
            } minimal: {
                ClockText(state: context.state).monospacedDigit().font(.caption2)
            }
            .widgetURL(URL(string: "playingtime://match/\(context.state.matchId)"))
        }
    }
}

func periodLabel(_ s: MatchClockState) -> String {
    switch s.phase {
    case "running": return "PERIOD \(s.period)"
    case "break": return "BREAK · P\(s.period)"
    default: return "READY"
    }
}

/// A ticking clock rendered by the system – no app updates needed while it runs.
struct ClockText: View {
    let state: MatchClockState
    var body: some View {
        if state.phase == "running", let zero = state.clockZero {
            Text(timerInterval: zero...Date.distantFuture, countsDown: false, showsHours: false)
        } else {
            Text(state.bankedText)
        }
    }
}

struct Controls: View {
    let state: MatchClockState
    var body: some View {
        HStack(spacing: 10) {
            if #available(iOS 17.0, *) {
                if state.phase == "running" {
                    Button(intent: EndPeriodIntent()) {
                        Label("PERIOD", systemImage: "pause.fill").frame(maxWidth: .infinity)
                    }
                    .tint(.orange)
                } else {
                    Button(intent: StartPeriodIntent()) {
                        Label("START", systemImage: "play.fill").frame(maxWidth: .infinity)
                    }
                    .tint(.green)
                }
            }
            Link(destination: URL(string: "playingtime://match/\(state.matchId)?sub=1")!) {
                Label("Sub", systemImage: "arrow.left.arrow.right")
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(Capsule().fill(Color.white.opacity(0.2)))
            }
        }
        .buttonStyle(.borderedProminent)
        .font(.headline)
    }
}

struct LockScreenView: View {
    let state: MatchClockState
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(state.title).font(.subheadline.bold()).lineLimit(1)
                Spacer()
                Text(periodLabel(state)).font(.subheadline.bold()).foregroundStyle(.yellow)
            }
            ClockText(state: state)
                .font(.system(size: 46, weight: .heavy).monospacedDigit())
            Controls(state: state)
        }
        .foregroundStyle(.white)
        .padding()
    }
}
