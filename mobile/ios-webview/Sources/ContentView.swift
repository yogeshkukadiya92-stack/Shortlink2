import SwiftUI

struct ContentView: View {
    var body: some View {
        NavigationStack {
            WebContainerView()
                .ignoresSafeArea(edges: .bottom)
                .toolbar(.hidden, for: .navigationBar)
        }
    }
}
