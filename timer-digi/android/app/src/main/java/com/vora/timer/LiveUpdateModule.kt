package com.vora.timer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas

import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class LiveUpdateModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "LiveUpdateModule"
    }

    private fun drawableToBitmap(drawable: Drawable): Bitmap {
        if (drawable is BitmapDrawable) {
            if (drawable.bitmap != null) {
                return drawable.bitmap
            }
        }
        val bitmap = if (drawable.intrinsicWidth <= 0 || drawable.intrinsicHeight <= 0) {
            Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        } else {
            Bitmap.createBitmap(drawable.intrinsicWidth, drawable.intrinsicHeight, Bitmap.Config.ARGB_8888)
        }
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, canvas.width, canvas.height)
        drawable.draw(canvas)
        return bitmap
    }

    private fun getLaunchPendingIntent(): PendingIntent? {
        val intent = reactApplicationContext.packageManager.getLaunchIntentForPackage(reactApplicationContext.packageName)
        return if (intent != null) {
            PendingIntent.getActivity(reactApplicationContext, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        } else null
    }

    @ReactMethod
    fun checkAndRequestPromotedPermission() {
        // Only run check on newer Android 15/16 versions
        if (Build.VERSION.SDK_INT >= 35) {
            try {
                val notificationManager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                
                // Reflect API 36 NotificationManager.canPostPromotedNotifications()
                val method = NotificationManager::class.java.getMethod("canPostPromotedNotifications")
                val isPromotedEnabled = method.invoke(notificationManager) as? Boolean ?: false
                
                if (!isPromotedEnabled) {
                    val intent = Intent("android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS").apply {
                        putExtra("android.provider.extra.APP_PACKAGE", reactApplicationContext.packageName)
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    reactApplicationContext.startActivity(intent)
                }
            } catch (e: Exception) {
                Log.d("LiveUpdateModule", "Android 16 API not fully present yet or error: " + e.message)
            }
        }
    }

    @ReactMethod
    fun startLiveUpdate(startTimeMs: Double, isPromoted: Boolean) {
        try {
            val channelId = "youtube-tracker"
            val notificationManager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(channelId, "YouTube Tracker Service", NotificationManager.IMPORTANCE_LOW)
                notificationManager.createNotificationChannel(channel)
            }

            val iconResId = reactApplicationContext.resources.getIdentifier("ic_launcher", "mipmap", reactApplicationContext.packageName)
            
            // Render the Android 16 Standard Promoted Notification (NO RemoteViews allowed!)
            val builder = Notification.Builder(reactApplicationContext, channelId)
                .setSmallIcon(if (iconResId != 0) iconResId else android.R.drawable.ic_menu_today)
                .setContentTitle("YT Tracker") // Shorter title
                .setContentText("Total YouTube watch time: ")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setWhen(startTimeMs.toLong())
                
            // Explicitly set count-up (timer mode)
            if (Build.VERSION.SDK_INT >= 24) {
                builder.setChronometerCountDown(false)
            }
                
            // Important: Use Standard style or BigTextStyle to avoid pill-overwrite by ProgressStyle
            builder.setStyle(Notification.BigTextStyle().bigText("Tracking YouTube watch time..."))
                
            // Attach Click intent! CRUCIAL for OS rules to promote it to a Pill!
            val pendingIntent = getLaunchPendingIntent()
            if (pendingIntent != null) {
                builder.setContentIntent(pendingIntent)
            }
            
            // Try formatting with the YouTube App Icon as the Large Colored Box
            try {
                val pm = reactApplicationContext.packageManager
                val ytDrawable = pm.getApplicationIcon("com.google.android.youtube")
                val ytBitmap = drawableToBitmap(ytDrawable)
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    builder.setLargeIcon(Icon.createWithBitmap(ytBitmap))
                } else {
                    @Suppress("DEPRECATION")
                    builder.setLargeIcon(ytBitmap)
                }
            } catch (e: Exception) {
                Log.d("LiveUpdateModule", "YouTube not installed or icon unavailable")
            }
                
            // Use STOPWATCH category to trigger the "Time Pill" chip instead of "Text Pill" chip
            builder.setCategory(Notification.CATEGORY_STOPWATCH)
            
            // Invoke Android 16 Developer Preview API using Reflection conditionally
            if (isPromoted) {
                try {
                    // Trial 1: setRequestPromotedOngoing (Success confirmed)
                    val promoteMethod = Notification.Builder::class.java.getMethod("setRequestPromotedOngoing", Boolean::class.javaPrimitiveType)
                    promoteMethod.invoke(builder, true)
                    Log.i("LiveUpdateModule", "Successfully requested Promoted Ongoing")

                    // DISCOVERY: Try all known hidden timer-chip flags for Android 16
                    val flagsToTry = listOf("setShortHasChronometer", "setChronometerInChip", "setTimerInChip", "setShortCriticalTextHasChronometer")
                    for (flagName in flagsToTry) {
                        try {
                            val m = Notification.Builder::class.java.getMethod(flagName, Boolean::class.javaPrimitiveType)
                            m.invoke(builder, true)
                            Log.i("LiveUpdateModule", "Successfully called Builder.$flagName(true)")
                        } catch (e: Exception) {}
                    }

                    // Trial 2: Ensure ShortCriticalText is null to allow timer takeover
                    try {
                        val shortTextMethod = Notification.Builder::class.java.getMethod("setShortCriticalText", String::class.java)
                        shortTextMethod.invoke(builder, null) 
                    } catch (e: Exception) {}

                } catch (e: Exception) {
                    Log.e("LiveUpdateModule", "Error in Builder reflection", e)
                }
            } else {
                Log.i("LiveUpdateModule", "Pill suppression requested. Skipping promotion.")
            }

            // Publish Native Notification
            notificationManager.notify(8888, builder.build())
        } catch (e: Exception) {
            Log.e("LiveUpdateModule", "Error starting live update", e)
        }
    }

    @ReactMethod
    fun stopLiveUpdate(totalSeconds: Double) {
        try {
            val channelId = "youtube-tracker"
            val notificationManager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            
            val iconResId = reactApplicationContext.resources.getIdentifier("ic_launcher", "mipmap", reactApplicationContext.packageName)

            val builder = Notification.Builder(reactApplicationContext, channelId)
                .setSmallIcon(if (iconResId != 0) iconResId else android.R.drawable.ic_menu_today)
                .setContentTitle("YouTube Timer Paused")
                .setContentText("Total focused time: ${totalSeconds.toInt()}s")
                .setOngoing(false)
                .setOnlyAlertOnce(true)
                
            val pendingIntent = getLaunchPendingIntent()
            if (pendingIntent != null) {
                builder.setContentIntent(pendingIntent)
            }
                
            notificationManager.notify(8888, builder.build())
        } catch (e: Exception) {
            Log.e("LiveUpdateModule", "Error stopping live update", e)
        }
    }
}
