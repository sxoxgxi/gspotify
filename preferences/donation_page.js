import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import GLib from "gi://GLib";

export function buildDonatePage(window, extensionPath) {
  const donatePage = new Adw.PreferencesPage({
    title: "Donate",
    icon_name: "emote-love-symbolic",
  });

  const donationGroup = new Adw.PreferencesGroup({
    title: "Support Development",
    description:
      "If you are enjoying GSpotify, consider supporting its development. Thank you!",
  });

  donatePage.add(donationGroup);

  const donations = [
    {
      coin: "Bitcoin",
      symbol: "BTC",
      address: "bc1q4f3lazm4qnj2jlvxf39sgre9rcuyk9kd8ln0qk",
      qr: "btc.svg",
    },
    {
      coin: "Ethereum on ERC20",
      symbol: "ETH",
      address: "0xAe56991F93E529EfE51EfA156fCEF9441f8c25a6",
      qr: "eth.svg",
    },
    {
      coin: "Solana",
      symbol: "SOL",
      address: "BfvfWHUtjHZryj114XuLXqXHp13SCMaXKGHS1AbD1sCo",
      qr: "sol.svg",
    },
    {
      coin: "USDT on ETH",
      symbol: "USDT",
      address: "0xAe56991F93E529EfE51EfA156fCEF9441f8c25a6",
      qr: "usdt.svg",
    },
    {
      coin: "USDC on ETH",
      symbol: "USDC",
      address: "0xAe56991F93E529EfE51EfA156fCEF9441f8c25a6",
      qr: "usdc.svg",
    },
    {
      coin: "Cardano",
      symbol: "ADA",
      address:
        "addr1qxqnnwz2k2467xfz6k5cu95m9evw4ech2wa38gzuqntrmq5p8xuy4v4t4uvj94df3ctfktjcatn3w5amzws9cpxk8kpq8nw9ex",
      qr: "ada.svg",
    },
    {
      coin: "BNB on BSC",
      symbol: "BNB",
      address: "0xAe56991F93E529EfE51EfA156fCEF9441f8c25a6",
      qr: "bnb.svg",
    },
    {
      coin: "Dogecoin on BSC",
      symbol: "DOGE",
      address: "0x197fe56ca3e574e3bc554e64b0a83248e14539c6",
      qr: "doge.svg",
    },
  ];

  donations.forEach((don) => {
    const row = new Adw.ActionRow({
      title: `${don.coin} (${don.symbol})`,
      subtitle: don.address,
      activatable: false,
    });

    const copyButton = new Gtk.Button({
      icon_name: "edit-copy-symbolic",
      valign: Gtk.Align.CENTER,
    });

    copyButton.connect("clicked", () => {
      let display = Gdk.Display.get_default();
      let clipboard = display.get_clipboard();
      clipboard.set(don.address);
      const dialog = new Adw.Toast({
        title: `${don.symbol} address copied`,
        timeout: 1,
      });
      window.add_toast(dialog);
    });

    row.add_suffix(copyButton);

    const qrButton = new Gtk.Button({
      icon_name: "image-x-generic-symbolic",
      valign: Gtk.Align.CENTER,
    });

    qrButton.connect("clicked", () => {
      const qrPath = GLib.build_filenamev([
        extensionPath,
        "preferences",
        "qr",
        don.qr,
      ]);

      const dialog = new Adw.MessageDialog({
        transient_for: window,
        heading: don.coin,
        body: `Scan this QR to donate using ${don.symbol}.`,
      });

      try {
        const texture = Gdk.Texture.new_from_filename(qrPath);
        const image = new Gtk.Picture({
          paintable: texture,
          content_fit: Gtk.ContentFit.CONTAIN,
        });
        image.set_size_request(200, 200);
        dialog.set_extra_child(image);
      } catch (e) {
        dialog.set_extra_child(
          new Gtk.Label({
            label:
              "QR code image not found.\nMake sure it is packaged in the extension.",
            justify: Gtk.Justification.CENTER,
          }),
        );
      }

      dialog.add_response("ok", "OK");
      dialog.present();
    });

    row.add_suffix(qrButton);

    row.activatable_widget = copyButton;

    donationGroup.add(row);
  });

  return donatePage;
}
