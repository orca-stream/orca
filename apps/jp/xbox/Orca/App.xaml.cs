using Windows.ApplicationModel.Activation;
using Windows.System.Profile;
using Windows.UI.ViewManagement;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;

namespace Orca;

/// <summary>A shell around the web app: one page holding a WebView2.</summary>
public sealed partial class App : Application
{
    public App()
    {
        InitializeComponent();
        // The pad drives the page with keys; without this the console shows a mouse-like cursor.
        RequiresPointerMode = ApplicationRequiresPointerMode.WhenRequested;
    }

    public static bool IsXbox => AnalyticsInfo.VersionInfo.DeviceFamily == "Windows.Xbox";

    protected override void OnLaunched(LaunchActivatedEventArgs e)
    {
        if (Window.Current.Content is not Frame frame)
        {
            if (IsXbox)
            {
                // Draw to the edges of the TV, as Netflix does, instead of inside the overscan margin.
                ApplicationView.GetForCurrentView().SetDesiredBoundsMode(ApplicationViewBoundsMode.UseCoreWindow);
            }

            frame = new Frame();
            Window.Current.Content = frame;
        }

        if (!e.PrelaunchActivated)
        {
            if (frame.Content == null)
            {
                frame.Navigate(typeof(MainPage), e.Arguments);
            }

            Window.Current.Activate();
        }
    }
}
