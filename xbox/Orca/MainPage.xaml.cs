using System;
using System.IO;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.ApplicationModel;
using Windows.Data.Json;
using Windows.System.Display;
using Windows.System.UserProfile;
using Windows.UI.Core;
using Windows.UI.ViewManagement;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;

namespace Orca;

/// <summary>
/// Hosts the built site (dist/, packaged under web/) in a WebView2. It is served from a plain-http
/// virtual host so Jellyfin servers on plain http in the home network are not blocked as mixed content.
/// </summary>
public sealed partial class MainPage : Page
{
    private const string Host = "orca.example";

    private readonly WebView2 _web = new();
    private readonly DisplayRequest _displayRequest = new();
    private bool _keepingScreenOn;

    public MainPage()
    {
        InitializeComponent();
        Root.Children.Add(_web);
        Loaded += (_, _) => FocusSink.Focus(FocusState.Programmatic);
        _web.CoreWebView2Initialized += OnCoreWebView2Initialized;
        Loaded += async (_, _) => await _web.EnsureCoreWebView2Async();
        SystemNavigationManager.GetForCurrentView().BackRequested += OnBackRequested;
    }

    private async void OnCoreWebView2Initialized(WebView2 sender, CoreWebView2InitializedEventArgs args)
    {
        if (args.Exception != null)
        {
            throw args.Exception;
        }

        var core = _web.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        // Autofill pops the on-screen keyboard down on Xbox.
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
#if !DEBUG
        core.Settings.AreDevToolsEnabled = false;
#endif

        var site = Path.Combine(Package.Current.InstalledLocation.Path, "web");
        core.SetVirtualHostNameToFolderMapping(Host, site, CoreWebView2HostResourceAccessKind.Allow);
        core.WebMessageReceived += OnWebMessageReceived;
        core.ContainsFullScreenElementChanged += OnFullScreenChanged;

        // Tells the page which shell it runs in, before any of its scripts, with the user's preferred
        // languages as the system keeps them (the console's language on Xbox), so the page does not
        // depend on how the WebView2 resolves its own.
        var host = new JsonObject
        {
            ["platform"] = JsonValue.CreateStringValue("uwp"),
            ["device"] = JsonValue.CreateStringValue(App.IsXbox ? "xbox" : "windows"),
            ["languages"] = Languages(),
        };
        await core.AddScriptToExecuteOnDocumentCreatedAsync($"window.orcaHost = {host.Stringify()};");

        _web.NavigationCompleted += (_, _) => FocusWeb();
        Window.Current.Activated += (_, e) =>
        {
            if (e.WindowActivationState != CoreWindowActivationState.Deactivated)
            {
                FocusWeb();
            }
        };
        _web.Source = new Uri($"http://{Host}/index.html");
    }

    /// <summary>
    /// Keys and the pad only reach the page while the WebView2 holds focus, and on Xbox it does not
    /// take it on its own (document.hasFocus() stays false). It gets it once the page has loaded, and
    /// again whenever the app comes back to the front.
    /// </summary>
    private void FocusWeb()
    {
        _ = Dispatcher.RunAsync(CoreDispatcherPriority.Low, async () =>
        {
            // Straight from the page to the WebView2 the focus does not stick: it goes through the
            // invisible FocusSink first, and the WebView2 takes it a moment later.
            FocusSink.Focus(FocusState.Programmatic);
            await System.Threading.Tasks.Task.Delay(100);
            _web.Focus(FocusState.Programmatic);
        });
    }

    private static JsonArray Languages()
    {
        var languages = new JsonArray();
        foreach (var language in GlobalizationPreferences.Languages)
        {
            languages.Add(JsonValue.CreateStringValue(language));
        }

        return languages;
    }

    /// <summary>The pad's B: the page closes what is open (player, title, menus) as it does on Back.</summary>
    private void OnBackRequested(object sender, BackRequestedEventArgs e)
    {
        if (_web.CoreWebView2 == null)
        {
            return;
        }

        e.Handled = true;
        _ = _web.CoreWebView2.ExecuteScriptAsync("window.orcaBack && window.orcaBack()");
    }

    /// <summary>Messages from the page: {"type":"playing","on":true} keeps the screen on while a video plays.</summary>
    private void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!JsonObject.TryParse(args.TryGetWebMessageAsString(), out var message))
        {
            return;
        }

        if (message.GetNamedString("type", string.Empty) == "playing")
        {
            KeepScreenOn(message.GetNamedBoolean("on", false));
        }
    }

    private void KeepScreenOn(bool on)
    {
        if (on == _keepingScreenOn)
        {
            return;
        }

        _keepingScreenOn = on;
        if (on)
        {
            _displayRequest.RequestActive();
        }
        else
        {
            _displayRequest.RequestRelease();
        }
    }

    /// <summary>On Windows the player's full screen takes the whole window; Xbox is always full screen.</summary>
    private void OnFullScreenChanged(CoreWebView2 sender, object args)
    {
        var view = ApplicationView.GetForCurrentView();
        if (sender.ContainsFullScreenElement)
        {
            view.TryEnterFullScreenMode();
        }
        else if (view.IsFullScreenMode)
        {
            view.ExitFullScreenMode();
        }
    }
}
